import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { test, expect, type Page } from '@playwright/test';
import { Repository } from '../../server/infrastructure/database';
import { HubService } from '../../server/application/hub';
import { createApp } from '../../server/http/app';
import { entityData, entityDataSchema } from '../../shared/schema';

let repository: Repository, hub: HubService, server: Server, url: string;
const history = '任务日志：commit abc123 已通过测试，待部署。\n历史说明不得删除。';
function create(entity: unknown) {
  return hub.submit(
    {
      requestId: randomUUID(),
      operations: [{ action: 'create', entity: entityDataSchema.parse(entity) }],
    },
    'mcp',
  ).result!.entities[0];
}
async function signIn(page: Page) {
  await page.goto(url);
  await page.getByLabel('密码', { exact: true }).fill('isolated-summary-browser-password');
  await page.getByLabel('确认密码', { exact: true }).fill('isolated-summary-browser-password');
  await page.getByRole('button', { name: '创建工作空间', exact: true }).click();
  await expect(page.getByRole('heading', { name: '项目总览', exact: true })).toBeVisible();
}
async function overview(page: Page) {
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /项目总览/ })
    .click();
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

test('cards separate introductions from legacy logs and preserve progress through confirmed edits', async ({
  page,
}, testInfo) => {
  const project = create({
    kind: 'project',
    name: '简介项目',
    summary: '管理个人软件项目。',
    description: history,
  });
  const legacy = create({ kind: 'project', name: '历史项目', description: history });
  repository.db
    .prepare("UPDATE entities SET data=json_remove(data,'$.summary') WHERE id=?")
    .run(legacy.id);
  create({ kind: 'task', projectId: project.id, title: '已有任务', status: 'done' });
  create({ kind: 'issue', projectId: project.id, title: '已有问题', status: 'open' });
  create({ kind: 'feature', projectId: project.id, title: '已有功能', status: 'done' });
  await signIn(page);
  const card = page
    .locator('.project-card')
    .filter({ has: page.getByRole('button', { name: '简介项目', exact: true }) });
  const oldCard = page
    .locator('.project-card')
    .filter({ has: page.getByRole('button', { name: '历史项目', exact: true }) });
  await expect(card.locator('.project-description')).toHaveText('管理个人软件项目。');
  await expect(oldCard.locator('.project-description')).toHaveText('暂无项目简介');
  await expect(page.locator('.project-grid')).not.toContainText('任务日志');
  await expect(card.getByRole('region', { name: '简介项目任务进度' })).toContainText(
    '1 / 1 已完成',
  );
  await expect(card.getByRole('region', { name: '简介项目问题进度' })).toContainText(
    '0 / 1 已解决或关闭',
  );
  await expect(card.getByRole('progressbar', { name: '简介项目功能完成进度' })).toHaveAttribute(
    'aria-valuenow',
    '1',
  );
  await page.screenshot({ path: testInfo.outputPath('summary-overview.png'), fullPage: true });
  await card.getByRole('button', { name: '简介项目', exact: true }).click();
  await expect(page.locator('.page-header .project-summary')).toHaveText('管理个人软件项目。');
  const disclosure = page.locator('details.project-description-disclosure');
  await expect(disclosure).toHaveJSProperty('open', false);
  await expect(disclosure.locator('p')).toBeHidden();
  await disclosure.locator('summary').click();
  await expect(disclosure.locator('p')).toBeVisible();
  expect(await disclosure.locator('p').textContent()).toBe(history);
  await page.getByRole('button', { name: '编辑项目', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('说明', { exact: true })).toHaveValue(history);
  await dialog.getByLabel('项目简介', { exact: true }).fill('取消的简介');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(repository.get(project.id)!.entity).toMatchObject({
    summary: '管理个人软件项目。',
    revision: 1,
  });
  await page.getByRole('button', { name: '编辑项目', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('项目简介', { exact: true }).fill('新简介'.repeat(167));
  await dialog.getByRole('button', { name: '生成变更提案', exact: true }).click();
  await expect(dialog.getByText('项目简介最多 500 个字符', { exact: true })).toBeVisible();
  await dialog.getByLabel('项目简介', { exact: true }).fill('仅包含项目用途的新简介。');
  await dialog.getByRole('button', { name: '生成变更提案', exact: true }).click();
  await expect(page.getByRole('heading', { name: '确认变更提案', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('仅包含项目用途的新简介。');
  expect(repository.get(project.id)!.entity).toMatchObject({
    summary: '管理个人软件项目。',
    revision: 1,
  });
  await page.getByRole('button', { name: '确认并应用', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(repository.get(project.id)!.entity).toMatchObject({
    summary: '仅包含项目用途的新简介。',
    description: history,
    revision: 2,
  });
  expect(
    repository
      .history()
      .some((event) =>
        event.changes.some(
          (change) =>
            change.id === project.id &&
            change.before?.kind === 'project' &&
            change.before.summary === '管理个人软件项目。',
        ),
      ),
  ).toBe(true);
  await overview(page);
  await page.reload();
  await expect(card.locator('.project-description')).toHaveText('仅包含项目用途的新简介。');
  await expect(card.getByRole('region', { name: '简介项目任务进度' })).toContainText(
    '1 / 1 已完成',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card.locator('.project-description')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('summary-mobile.png'), fullPage: true });
});

test('new projects support summary search and explicitly clearing the summary without deleting descriptions', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('button', { name: '＋ 新建项目', exact: true }).first().click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('项目名称', { exact: false }).fill('创建简介项目');
  await dialog.getByLabel('项目简介', { exact: true }).fill('  独特检索词：个人项目管理。  ');
  await dialog.getByLabel('说明', { exact: true }).fill(history);
  await dialog.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const card = page.locator('.project-card');
  await expect(card.locator('.project-description')).toHaveText('独特检索词：个人项目管理。');
  const search = page.getByRole('searchbox');
  await search.fill('独特检索词');
  await expect(card).toHaveCount(1);
  await expect(page.getByText('没有匹配的项目', { exact: true })).toHaveCount(0);
  await search.fill('abc123');
  await expect(card).toHaveCount(1);
  await expect(card).not.toContainText('任务日志');
  await search.fill('');
  await card.getByRole('button', { name: '查看项目 →', exact: true }).click();
  await page.getByRole('button', { name: '编辑项目', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('项目简介', { exact: true }).fill('');
  await dialog.getByRole('button', { name: '生成变更提案', exact: true }).click();
  await page.getByRole('button', { name: '确认并应用', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.page-header .project-summary')).toHaveText('暂无项目简介');
  const disclosure = page.locator('details.project-description-disclosure');
  await expect(disclosure).toHaveJSProperty('open', false);
  await expect(disclosure.locator('p')).toBeHidden();
  await disclosure.locator('summary').click();
  await expect(disclosure.locator('p')).toBeVisible();
  expect(await disclosure.locator('p').textContent()).toBe(history);
  await overview(page);
  await expect(card.locator('.project-description')).toHaveText('暂无项目简介');
  await expect(card).not.toContainText('任务日志');
  const snapshot = await (await page.request.get(url + '/api/snapshot')).json();
  expect(snapshot.entities[0]).toMatchObject({ summary: '', description: history });
});

test('legacy proposals preview and preserve an omitted introduction when confirmed', async ({
  page,
}) => {
  const project = create({
    kind: 'project',
    name: '旧客户端项目',
    summary: '应保留的简介',
    description: history,
  });
  const proposal = hub.submit(
    {
      requestId: randomUUID(),
      operations: [
        {
          action: 'update',
          id: project.id,
          expectedRevision: project.revision,
          entity: entityDataSchema.parse({
            kind: 'project',
            name: '旧客户端项目',
            description: history + '\n补充的历史记录。',
          }),
        },
      ],
    },
    'web',
  );
  expect(proposal.status).toBe('pending');
  await signIn(page);
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /待确认变更/ })
    .click();
  await page.getByRole('button', { name: '查看并确认 →', exact: true }).click();
  const after = page.getByRole('dialog').locator('.diff-grid > section').nth(1);
  await expect(after).toContainText('应保留的简介');
  await expect(after).toContainText('补充的历史记录。');
  expect(repository.get(project.id)!.entity.revision).toBe(1);
  await page.getByRole('button', { name: '确认并应用', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(repository.get(project.id)!.entity).toMatchObject({
    summary: '应保留的简介',
    description: history + '\n补充的历史记录。',
    revision: 2,
  });
  await overview(page);
  await expect(page.locator('.project-description')).toHaveText('应保留的简介');
});

test('project descriptions support keyboard disclosure and start closed on every navigation visit', async ({
  page,
}) => {
  const original = '项目 A 的完整说明。\n\n  保留原有缩进。\n最后一行。';
  const projectA = create({
    kind: 'project',
    name: '说明项目 A',
    summary: '项目 A 的独立简介。',
    description: original,
  });
  const projectB = create({
    kind: 'project',
    name: '说明项目 B',
    summary: '项目 B 的独立简介。',
    description: '只属于项目 B 的完整说明。',
  });
  await signIn(page);

  const disclosure = page.locator('details.project-description-disclosure');
  const toggle = disclosure.locator('summary');
  const description = disclosure.locator('p');
  const introduction = page.locator('.page-header .project-summary');
  async function expectClosed(name: string, summary: string) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(introduction).toHaveText(summary);
    await expect(toggle).toHaveText('项目说明');
    await expect(disclosure).toHaveJSProperty('open', false);
    await expect(description).toBeHidden();
  }

  await page.getByRole('button', { name: '说明项目 A', exact: true }).click();
  await expectClosed('说明项目 A', '项目 A 的独立简介。');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveJSProperty('open', true);
  await expect(description).toBeVisible();
  expect(await description.textContent()).toBe(original);
  await expect(description).toHaveCSS('white-space', 'pre-wrap');
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveJSProperty('open', false);
  await expect(description).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(description).toBeVisible();

  const refreshedDescription = original + '\n后台刷新补充的说明。';
  const current = repository.get(projectA.id)!.entity;
  const refreshed = hub.submit(
    {
      requestId: randomUUID(),
      operations: [
        {
          action: 'update',
          id: current.id,
          expectedRevision: current.revision,
          entity: entityDataSchema.parse({
            ...entityData(current),
            summary: '项目 A 更新后的独立简介。',
            description: refreshedDescription,
          }),
        },
      ],
    },
    'mcp',
  );
  expect(refreshed.status).toBe('applied');
  await page.getByRole('button', { name: '刷新数据', exact: true }).click();
  await expect(introduction).toHaveText('项目 A 更新后的独立简介。');
  await expect(disclosure).toHaveJSProperty('open', true);
  await expect(description).toBeVisible();
  expect(await description.textContent()).toBe(refreshedDescription);

  await page.getByRole('button', { name: '← 返回项目总览', exact: true }).click();
  await page.getByRole('button', { name: '说明项目 A', exact: true }).click();
  await expectClosed('说明项目 A', '项目 A 更新后的独立简介。');
  await toggle.click();
  await expect(description).toBeVisible();
  await overview(page);
  await page.getByRole('button', { name: '说明项目 B', exact: true }).click();
  await expectClosed('说明项目 B', '项目 B 的独立简介。');
  await toggle.click();
  await expect(description).toBeVisible();
  expect(await description.textContent()).toBe('只属于项目 B 的完整说明。');
  expect(new URL(page.url()).searchParams.get('project')).toBe(projectB.id);

  await page.goBack();
  await expect(page.getByRole('heading', { name: '项目总览', exact: true })).toBeVisible();
  await page.goBack();
  await expectClosed('说明项目 A', '项目 A 更新后的独立简介。');
  await toggle.click();
  await expect(description).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: '项目总览', exact: true })).toBeVisible();
  await page.goForward();
  await expectClosed('说明项目 B', '项目 B 的独立简介。');
  await toggle.click();
  await expect(description).toBeVisible();
  await page.reload();
  await expectClosed('说明项目 B', '项目 B 的独立简介。');
});

test('empty introductions and descriptions have separate detail placeholders', async ({ page }) => {
  create({ kind: 'project', name: '空白说明项目', summary: '', description: '' });
  await signIn(page);
  await page.getByRole('button', { name: '空白说明项目', exact: true }).click();
  await expect(page.locator('.page-header .project-summary')).toHaveText('暂无项目简介');
  const disclosure = page.locator('details.project-description-disclosure');
  await expect(disclosure).toHaveJSProperty('open', false);
  await expect(disclosure.locator('p')).toBeHidden();
  await disclosure.locator('summary').click();
  await expect(disclosure.locator('p')).toBeVisible();
  await expect(disclosure.locator('p')).toHaveText('暂无项目说明');
  await disclosure.locator('summary').click();
  await expect(disclosure.locator('p')).toBeHidden();
  const snapshot = await (await page.request.get(url + '/api/snapshot')).json();
  expect(snapshot.entities[0]).toMatchObject({ summary: '', description: '' });
});

test('long introductions and expanded original descriptions fit desktop and narrow screens', async ({
  page,
}, testInfo) => {
  const longSummary = '长简介：' + 's'.repeat(480);
  const original =
    '原文首行，保留空格和换行。\n  原始缩进内容。\nhttps://example.test/' +
    'description'.repeat(70) +
    '\n原文最后一行。';
  create({ kind: 'project', name: '长说明阅读项目', summary: longSummary, description: original });
  await signIn(page);
  await page.getByRole('button', { name: '长说明阅读项目', exact: true }).click();
  const introduction = page.locator('.page-header .project-summary');
  const disclosure = page.locator('details.project-description-disclosure');
  const description = disclosure.locator('p');
  await expect(introduction).toBeVisible();
  expect(await introduction.textContent()).toBe(longSummary);
  await expect(disclosure).toHaveJSProperty('open', false);
  await disclosure.locator('summary').click();
  await expect(description).toBeVisible();
  expect(await description.textContent()).toBe(original);
  await expect(description).toHaveCSS('white-space', 'pre-wrap');
  expect(
    await page.evaluate(
      () => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('project-description-desktop.png'),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(introduction).toBeVisible();
  await expect(description).toBeVisible();
  expect(await introduction.textContent()).toBe(longSummary);
  expect(await description.textContent()).toBe(original);
  expect(
    await page.evaluate(
      () => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('project-description-mobile.png'),
    fullPage: true,
  });
});
