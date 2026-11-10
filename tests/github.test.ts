import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Repository } from '../server/infrastructure/database';
import { HubService } from '../server/application/hub';
import { GitHubActionsService } from '../server/integrations/github';
let repository: Repository, hub: HubService, id: string;
const run = {
  id: 42,
  name: 'CI',
  status: 'completed',
  conclusion: 'success',
  head_branch: 'main',
  event: 'push',
  created_at: '2026-11-10T00:00:00Z',
  html_url: 'https://github.com/example/repo/actions/runs/42',
};
beforeEach(() => {
  repository = new Repository(':memory:');
  hub = new HubService(repository);
  id = hub.submit(
    {
      requestId: randomUUID(),
      operations: [
        {
          action: 'create',
          entity: {
            kind: 'project',
            name: 'GitHub test',
            repository: 'example/repo',
            deployedVersion: 'v0.0.1',
          },
        },
      ],
    },
    'web',
  ).result!.entities[0].id;
});
afterEach(() => repository.close());
it('only sends an explicit GET and never changes release or deployment state', async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ workflow_runs: [run] })),
  );
  const service = new GitHubActionsService(repository, 'fixture-token-not-a-real-secret', fetcher);
  expect(fetcher).not.toHaveBeenCalled();
  const before = repository.get(id);
  const result = await service.refresh(id);
  expect(result.runs).toHaveLength(1);
  expect(result.error).toBeNull();
  expect(fetcher.mock.calls[0][0]).toBe(
    'https://api.github.com/repos/example/repo/actions/runs?per_page=5',
  );
  expect(fetcher.mock.calls[0][1]?.method).toBe('GET');
  expect(repository.get(id)).toEqual(before);
  expect(JSON.stringify(result)).not.toContain('fixture-token');
});
it.each([
  [401, '授权无效'],
  [403, '额度'],
  [404, '找不到仓库'],
  [500, '暂时无法'],
])('reports GitHub %s safely and preserves last good results', async (status, message) => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ workflow_runs: [run] })))
    .mockResolvedValueOnce(
      new Response('{}', { status, headers: { 'x-ratelimit-remaining': '0' } }),
    );
  const service = new GitHubActionsService(repository, undefined, fetcher),
    good = await service.refresh(id),
    failed = await service.refresh(id);
  expect(failed.error).toContain(message);
  expect(failed.runs).toEqual(good.runs);
  expect(failed.updatedAt).toBe(good.updatedAt);
});
it('handles network failure and rejects unsafe output links', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ workflow_runs: [{ ...run, html_url: 'https://attacker.example/' }] }),
      ),
    );
  const service = new GitHubActionsService(repository, undefined, fetcher);
  expect((await service.refresh(id)).error).toBeTruthy();
  expect((await service.refresh(id)).runs).toHaveLength(0);
});
it('does not expose cached results from a previous repository', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ workflow_runs: [run] })))
    .mockRejectedValueOnce(new Error('offline'));
  const service = new GitHubActionsService(repository, undefined, fetcher);
  await service.refresh(id);
  const project = repository.get(id)!.entity;
  if (project.kind !== 'project') throw Error('fixture');
  repository.put({ ...project, repository: 'example/other' });
  const result = await service.refresh(id);
  expect(result.repository).toBe('example/other');
  expect(result.runs).toHaveLength(0);
  expect(result.updatedAt).toBeNull();
});
it('rejects duplicate in-flight refreshes', async () => {
  let finish!: (value: Response) => void;
  const promise = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const service = new GitHubActionsService(
    repository,
    undefined,
    vi.fn<typeof fetch>(() => promise),
  );
  const first = service.refresh(id);
  await expect(service.refresh(id)).rejects.toThrow('正在刷新');
  finish(new Response(JSON.stringify({ workflow_runs: [] })));
  await first;
});

it.each(['repository', 'deletion'])(
  'discards an in-flight response after project %s changes',
  async (change) => {
    let finish!: (value: Response) => void;
    const deferred = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const service = new GitHubActionsService(
      repository,
      undefined,
      vi.fn<typeof fetch>(() => deferred),
    );
    const pending = service.refresh(id);
    const project = repository.get(id)!.entity;
    if (project.kind !== 'project') throw Error('fixture');
    if (change === 'repository')
      repository.put({ ...project, repository: 'example/new-repo', revision: 2 });
    else repository.put({ ...project, revision: 2 }, true);
    finish(new Response(JSON.stringify({ workflow_runs: [run] })));
    await expect(pending).rejects.toThrow('项目已修改或删除');
    expect(repository.actions()).toHaveLength(0);
  },
);
