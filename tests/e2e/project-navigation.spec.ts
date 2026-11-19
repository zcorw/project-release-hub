import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { test, expect, type Page } from '@playwright/test';
import { Repository } from '../../server/infrastructure/database';
import { HubService } from '../../server/application/hub';
import { createApp } from '../../server/http/app';
import { entityDataSchema } from '../../shared/schema';

let repository: Repository, hub: HubService, server: Server, url: string;
const password = 'isolated-navigation-browser-password';

function create(entity: unknown) {
  const request = hub.submit(
    {
      requestId: randomUUID(),
      operations: [{ action: 'create', entity: entityDataSchema.parse(entity) }],
    },
    'mcp',
  );
  expect(request.status).toBe('applied');
  return request.result!.entities[0];
}

async function setUp(page: Page, path = '', heading = '项目总览') {
  await page.goto(url + path);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('确认密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建工作空间', exact: true }).click();
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
}

async function projectShown(page: Page, id: string, name: string) {
  await expect(page).toHaveURL((value) => value.searchParams.get('project') === id);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

function nav(page: Page, name: string) {
  return page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name });
}

test.beforeEach(async () => {
  repository = new Repository(':memory:');
  hub = new HubService(repository);
  server = createServer(createApp({ repository, disableRateLimit: true }).app);
  server.keepAliveTimeout = 1;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

test.afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  repository.close();
});

test('project links survive reloads and history navigation with matching records and workspace views', async ({
  page,
  context,
}, testInfo) => {
  const projectA = create({ kind: 'project', name: '导航项目 A', summary: '项目 A 简介' });
  const projectB = create({ kind: 'project', name: '导航项目 B', summary: '项目 B 简介' });
  create({ kind: 'feature', projectId: projectA.id, title: '仅属于 A 的功能' });
  create({ kind: 'feature', projectId: projectB.id, title: '仅属于 B 的功能' });
  await setUp(page, '/?source=navigation-test#records');

  await page.getByRole('button', { name: '导航项目 A', exact: true }).click();
  await projectShown(page, projectA.id, '导航项目 A');
  expect(new URL(page.url()).searchParams.get('source')).toBe('navigation-test');
  expect(new URL(page.url()).hash).toBe('#records');
  await expect(page.locator('.record')).toContainText('仅属于 A 的功能');
  await expect(page.locator('.record')).not.toContainText('仅属于 B 的功能');
  await page.reload();
  await projectShown(page, projectA.id, '导航项目 A');
  await page.getByRole('button', { name: '← 返回项目总览', exact: true }).click();
  await expect(page).toHaveURL((value) => !value.searchParams.has('project'));
  await page.getByRole('button', { name: '导航项目 B', exact: true }).click();
  await projectShown(page, projectB.id, '导航项目 B');
  await expect(page.locator('.record')).toContainText('仅属于 B 的功能');

  await page.goBack();
  await expect(page.getByRole('heading', { name: '项目总览', exact: true })).toBeVisible();
  await page.goBack();
  await projectShown(page, projectA.id, '导航项目 A');
  await expect(page.locator('.record')).toContainText('仅属于 A 的功能');
  await page.goForward();
  await expect(page.getByRole('heading', { name: '项目总览', exact: true })).toBeVisible();
  await page.goForward();
  await projectShown(page, projectB.id, '导航项目 B');

  await nav(page, '待确认变更').click();
  await expect(page).toHaveURL((value) => value.searchParams.get('view') === 'pending');
  expect(new URL(page.url()).searchParams.has('project')).toBe(false);
  await nav(page, '操作历史').click();
  await expect(page).toHaveURL((value) => value.searchParams.get('view') === 'history');
  await page.goBack();
  await expect(page.getByRole('heading', { name: '待确认变更', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '待确认变更', exact: true })).toBeVisible();
  await page.goBack();
  await projectShown(page, projectB.id, '导航项目 B');

  const direct = await context.newPage();
  await direct.goto(`${url}/?project=${projectA.id}`);
  await projectShown(direct, projectA.id, '导航项目 A');
  await expect(direct.locator('.record')).toContainText('仅属于 A 的功能');
  await direct.screenshot({ path: testInfo.outputPath('project-direct-link.png'), fullPage: true });
});

test('a project deep link survives account setup, logout, and an expired browser session', async ({
  page,
  context,
}) => {
  const project = create({ kind: 'project', name: '登录后恢复项目' });
  const path = `/?project=${project.id}&source=deep-link#details`;
  await setUp(page, path, '登录后恢复项目');
  await projectShown(page, project.id, '登录后恢复项目');

  await page.getByRole('button', { name: /退出登录/ }).click();
  await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('project')).toBe(project.id);
  await page.reload();
  await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible();
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '进入工作空间', exact: true }).click();
  await projectShown(page, project.id, '登录后恢复项目');

  await context.clearCookies();
  await page.reload();
  await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('project')).toBe(project.id);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '进入工作空间', exact: true }).click();
  await projectShown(page, project.id, '登录后恢复项目');
  expect(new URL(page.url()).searchParams.get('source')).toBe('deep-link');
  expect(new URL(page.url()).hash).toBe('#details');
});

test('invalid and unavailable project links explain the problem and return to the overview', async ({
  page,
}, testInfo) => {
  const existing = create({ kind: 'project', name: '仍然存在的项目' });
  const task = create({ kind: 'task', projectId: existing.id, title: '不能用作项目 ID 的任务' });
  await setUp(page);
  const cases = [
    { id: '', message: '项目 ID 无效。' },
    { id: 'not-a-project', message: '项目 ID 无效。' },
    { id: randomUUID(), message: '项目不存在或已被删除。' },
    { id: task.id, message: '项目不存在或已被删除。' },
  ];
  for (const { id, message } of cases) {
    await test.step(id || 'empty project ID', async () => {
      await page.goto(`${url}/?source=unavailable&project=${id}#details`);
      await expect(page.getByRole('heading', { name: '项目不可用', exact: true })).toBeVisible();
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.getByRole('alert')).toContainText(message);
      await expect(page.locator('.project-grid')).toHaveCount(0);
      expect(new URL(page.url()).searchParams.get('project')).toBe(id);
      if (id === 'not-a-project')
        await page.screenshot({
          path: testInfo.outputPath('project-unavailable.png'),
          fullPage: true,
        });
      await page.getByRole('button', { name: '返回项目总览', exact: true }).click();
      await expect(page.getByRole('heading', { name: '项目总览', exact: true })).toBeVisible();
      expect(new URL(page.url()).searchParams.has('project')).toBe(false);
      expect(new URL(page.url()).searchParams.get('source')).toBe('unavailable');
      expect(new URL(page.url()).hash).toBe('#details');
    });
  }
});

test('delayed and failed snapshots keep a valid deep link recoverable without a missing-project error', async ({
  page,
}) => {
  const project = create({ kind: 'project', name: '等待数据的项目' });
  await setUp(page);
  let phase: 'delayed' | 'failed' | 'normal' = 'delayed';
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const requested = new Promise<void>((resolve) => (entered = resolve));
  await page.route('**/api/snapshot', async (route) => {
    if (phase === 'delayed') {
      entered();
      await gate;
      await route.continue();
    } else if (phase === 'failed')
      await route.fulfill({
        status: 503,
        json: { error: { code: 'TEMPORARY', message: '快照暂时不可用，请重试。' } },
      });
    else await route.continue();
  });
  try {
    await page.goto(`${url}/?project=${project.id}`, { waitUntil: 'domcontentloaded' });
    await requested;
    await expect(page.getByText('正在同步最新数据…', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '项目不可用', exact: true })).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('project')).toBe(project.id);
  } finally {
    phase = 'normal';
    release();
  }
  await projectShown(page, project.id, '等待数据的项目');

  phase = 'failed';
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('快照暂时不可用，请重试。');
  await expect(page.getByRole('heading', { name: '项目不可用', exact: true })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('project')).toBe(project.id);
  phase = 'normal';
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await projectShown(page, project.id, '等待数据的项目');
  await expect(page.getByRole('alert')).toHaveCount(0);

  phase = 'failed';
  await page.getByRole('button', { name: '刷新数据', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('快照暂时不可用，请重试。');
  await projectShown(page, project.id, '等待数据的项目');
  phase = 'normal';
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('project deletion keeps the current link through review and shows unavailable only after confirmation', async ({
  page,
}) => {
  const project = create({ kind: 'project', name: '经确认删除的项目' });
  await setUp(page);
  await page.getByRole('button', { name: '经确认删除的项目', exact: true }).click();
  const remove = page.locator('.page-header').getByRole('button', { name: '删除', exact: true });

  await remove.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('project')).toBe(project.id);
  await page.getByRole('button', { name: '稍后处理', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await projectShown(page, project.id, '经确认删除的项目');
  expect(repository.get(project.id)!.deleted).toBe(false);

  await remove.click();
  await page.getByRole('button', { name: '拒绝此变更', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await projectShown(page, project.id, '经确认删除的项目');
  expect(repository.get(project.id)!.deleted).toBe(false);

  await remove.click();
  await page.getByRole('button', { name: '确认并应用', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '项目不可用', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('项目不存在或已被删除。');
  expect(new URL(page.url()).searchParams.get('project')).toBe(project.id);
  expect(repository.get(project.id)!.deleted).toBe(true);
  await page.getByRole('button', { name: '返回项目总览', exact: true }).click();
  await expect(page.getByRole('heading', { name: '项目总览', exact: true })).toBeVisible();
});

test('browser navigation closes an old project editor and resets the selected record tab', async ({
  page,
}) => {
  const project = create({ kind: 'project', name: '历史导航编辑项目' });
  await setUp(page);
  await page.getByRole('button', { name: '历史导航编辑项目', exact: true }).click();
  await page.getByRole('tab', { name: /任务/ }).click();
  await page.getByRole('button', { name: '编辑项目', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: '项目总览', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goForward();
  await projectShown(page, project.id, '历史导航编辑项目');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /功能计划/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('a delayed proposal from a previous project cannot replace the current editor', async ({
  page,
}) => {
  const projectA = create({ kind: 'project', name: '星河发版工作台' });
  const projectB = create({ kind: 'project', name: '相机协议实验室' });
  const proposedName = '项目 A 的延迟改名提案';
  let release!: () => void;
  let entered!: () => void;
  let pendingId = '';
  const gate = new Promise<void>((resolve) => (release = resolve));
  const requested = new Promise<void>((resolve) => (entered = resolve));
  await setUp(page);
  await page.route('**/api/changes', async (route) => {
    const response = await route.fetch();
    const proposal = await response.json();
    pendingId = proposal.id;
    entered();
    await gate;
    await route.fulfill({ response });
  });
  const delivered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/changes' && response.request().method() === 'POST',
  );

  try {
    await page.getByRole('button', { name: '星河发版工作台', exact: true }).click();
    await page.getByRole('button', { name: '编辑项目', exact: true }).click();
    await page.getByRole('dialog').getByLabel('项目名称', { exact: false }).fill(proposedName);
    await page.getByRole('button', { name: '生成变更提案', exact: true }).click();
    await requested;
    expect(repository.requests().find((request) => request.id === pendingId)?.status).toBe(
      'pending',
    );
    expect(repository.get(projectA.id)!.entity).toMatchObject({
      name: '星河发版工作台',
      revision: 1,
    });

    await page.goBack();
    await expect(page.getByRole('heading', { name: '项目总览', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '相机协议实验室', exact: true }).click();
    await projectShown(page, projectB.id, '相机协议实验室');
    await page.getByRole('button', { name: '编辑项目', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByLabel('项目简介', { exact: true })
      .fill('项目 B 尚未提交的草稿');
  } finally {
    release();
  }

  await (await delivered).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const editor = page.getByRole('dialog');
  await expect(editor).toHaveCount(1);
  await expect(editor.getByLabel('项目名称', { exact: false })).toHaveValue('相机协议实验室');
  await expect(editor.getByLabel('项目简介', { exact: true })).toHaveValue('项目 B 尚未提交的草稿');
  await expect(page.getByRole('heading', { name: '确认变更提案', exact: true })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('project')).toBe(projectB.id);
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await nav(page, '待确认变更').click();
  await page.getByRole('button', { name: '刷新数据', exact: true }).click();
  const pending = page.locator('.pending-card').filter({ hasText: proposedName });
  await expect(pending).toHaveCount(1);
  await expect(pending).toContainText(pendingId);
  expect(repository.get(projectA.id)!.entity).toMatchObject({
    name: '星河发版工作台',
    revision: 1,
  });
  expect(repository.get(projectB.id)!.entity).toMatchObject({
    name: '相机协议实验室',
    summary: '',
    revision: 1,
  });
});
