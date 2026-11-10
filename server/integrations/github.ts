import { z } from 'zod';
import type { ActionsSnapshot } from '../../shared/schema';
import { Repository } from '../infrastructure/database';
import { AppError } from '../domain/errors';
const responseSchema = z.object({
  workflow_runs: z
    .array(
      z.object({
        id: z.number().int().positive(),
        name: z.string().nullable(),
        status: z.string().nullable(),
        conclusion: z.string().nullable(),
        head_branch: z.string().nullable(),
        event: z.string(),
        created_at: z.string(),
        html_url: z.url().refine((v) => {
          const url = new URL(v);
          return url.protocol === 'https:' && url.hostname === 'github.com';
        }),
      }),
    )
    .max(100),
});
export class GitHubActionsService {
  private readonly inFlight = new Set<string>();
  constructor(
    private readonly repository: Repository,
    private readonly token?: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async refresh(projectId: string): Promise<ActionsSnapshot> {
    const stored = this.repository.get(projectId);
    if (!stored || stored.deleted || stored.entity.kind !== 'project')
      throw new AppError('NOT_FOUND', '项目不存在', 404);
    const project = stored.entity;
    if (!project.repository)
      throw new AppError('REPOSITORY_REQUIRED', '请先填写 owner/repo 格式的 GitHub 仓库');
    if (this.inFlight.has(projectId))
      throw new AppError('REFRESH_IN_PROGRESS', '该项目正在刷新，请稍候', 409);
    this.inFlight.add(projectId);
    const previous = this.repository
      .actions()
      .find((a) => a.projectId === projectId && a.repository === project.repository);
    const snapshot: ActionsSnapshot = {
      projectId,
      repository: project.repository,
      runs: previous?.runs ?? [],
      updatedAt: previous?.updatedAt ?? null,
      attemptedAt: new Date().toISOString(),
      error: null,
    };
    try {
      const [owner, repo] = project.repository.split('/');
      const response = await this.fetcher(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?per_page=5`,
        {
          method: 'GET',
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'Project-Release-Hub',
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          },
        },
      );
      if (!response.ok) {
        const messages: Record<number, string> = {
          401: 'GitHub 授权无效，请检查本地配置的 GITHUB_TOKEN。',
          403:
            response.headers.get('x-ratelimit-remaining') === '0'
              ? 'GitHub API 额度已用完，请稍后再试。'
              : '没有读取 Actions 的权限，请检查令牌的只读 Actions 权限。',
          404: '找不到仓库，或没有私有仓库的访问权限。',
        };
        throw new AppError(
          'GITHUB_ERROR',
          messages[response.status] ?? 'GitHub 暂时无法提供 Actions 信息，请稍后重试。',
          502,
        );
      }
      const parsed = responseSchema.parse(await response.json());
      snapshot.runs = parsed.workflow_runs.slice(0, 5).map((run) => ({
        id: run.id,
        name: run.name ?? 'Workflow',
        status: run.status ?? 'unknown',
        conclusion: run.conclusion,
        branch: run.head_branch ?? '',
        event: run.event,
        createdAt: run.created_at,
        url: run.html_url,
      }));
      snapshot.updatedAt = new Date().toISOString();
    } catch (error) {
      snapshot.error =
        error instanceof AppError
          ? error.message
          : error instanceof Error && error.name === 'TimeoutError'
            ? 'GitHub 请求超时，请稍后重试。'
            : '无法读取 GitHub Actions，请检查网络、仓库地址或 GitHub 返回的数据。';
    } finally {
      this.inFlight.delete(projectId);
    }
    const current = this.repository.get(projectId);
    if (
      !current ||
      current.deleted ||
      current.entity.kind !== 'project' ||
      current.entity.repository !== project.repository
    )
      throw new AppError('PROJECT_CHANGED', '项目已修改或删除，请刷新数据后重新读取', 409);
    this.repository.saveActions(snapshot);
    return snapshot;
  }
}
