import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { test, expect, type Page } from '@playwright/test';
import { Repository } from '../../server/infrastructure/database';
import { HubService } from '../../server/application/hub';
import { createApp } from '../../server/http/app';
import { entityData, type Entity } from '../../shared/schema';

let repository: Repository, hub: HubService, server: Server, url: string, project: Entity;
function update(base: Entity, fields: Record<string, string>) {
  return hub.submit(
    {
      requestId: randomUUID(),
      operations: [
        {
          action: 'update',
          id: base.id,
          expectedRevision: base.revision,
          entity: { ...entityData(base), ...fields },
        },
      ],
    },
    'mcp',
  );
}
test.beforeEach(async () => {
  repository = new Repository(':memory:');
  hub = new HubService(repository);
  project = hub.submit(
    {
      requestId: randomUUID(),
      operations: [
        {
          action: 'create',
          entity: { kind: 'project', name: '合并验收项目' },
        },
      ],
    },
    'web',
  ).result!.entities[0];
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
async function openProposal(page: Page, id: string) {
  await page.goto(url);
  await page.getByLabel('密码', { exact: true }).fill('isolated-rebase-browser-password');
  await page.getByLabel('确认密码', { exact: true }).fill('isolated-rebase-browser-password');
  await page.getByRole('button', { name: '创建工作空间', exact: true }).click();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /待确认变更/ })
    .click();
  await page
    .locator('.pending-card')
    .filter({ hasText: id })
    .getByRole('button', { name: '查看并确认 →' })
    .click();
  await page.getByRole('button', { name: '基于最新记录重新合并', exact: true }).click();
  await expect(page.getByRole('heading', { name: '重新合并提案', exact: true })).toBeVisible();
}

test('legacy nonconflicting reconciliation can cancel and generates a separate review', async ({
  page,
}) => {
  const source = update(project, { description: '需要保留的提案内容' });
  const legacy = repository.request(source.id)!;
  delete legacy.request.baseEntities;
  repository.saveRequest(legacy.request, legacy.hash);
  hub.confirm(update(project, { environmentName: '已经合并的环境名' }).id);
  await openProposal(page, source.id);
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByText('没有字段冲突，已保留最新记录中的修改。')).toBeVisible();
  await dialog.getByRole('button', { name: '返回原提案', exact: true }).click();
  expect(hub.request(source.id).status).toBe('pending');
  expect(repository.get(project.id)!.entity.revision).toBe(2);
  await dialog.getByRole('button', { name: '基于最新记录重新合并', exact: true }).click();
  await dialog.getByRole('button', { name: '生成新提案', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '确认变更提案', exact: true })).toBeVisible();
  const replacement = hub.request(hub.request(source.id).supersededBy!);
  expect(replacement.status).toBe('pending');
  expect(replacement.operations[0]).toMatchObject({
    entity: {
      description: '需要保留的提案内容',
      environmentName: '已经合并的环境名',
    },
  });
  expect(repository.get(project.id)!.entity).toMatchObject({ description: '', revision: 2 });
  await dialog.getByRole('button', { name: '稍后处理', exact: true }).click();
  await expect(page.locator('.pending-card')).toHaveCount(1);
  await page.locator('.pending-card').getByRole('button', { name: '查看并确认 →' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '确认并应用', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(repository.get(project.id)!.entity).toMatchObject({
    description: '需要保留的提案内容',
    environmentName: '已经合并的环境名',
    revision: 3,
  });
});

test('conflicts require selection, stale previews refresh and uncertain generation retries safely', async ({
  page,
}) => {
  const source = update(project, { description: '提案中的说明', name: '新项目名称' });
  hub.confirm(update(project, { description: '已经合并的说明', status: 'paused' }).id);
  await openProposal(page, source.id);
  const dialog = page.getByRole('dialog');
  const group = dialog.getByRole('group', { name: '说明冲突' });
  await expect(group).toBeVisible();
  await expect(group.getByRole('radio').nth(0)).not.toBeChecked();
  await expect(group.getByRole('radio').nth(1)).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: '生成新提案', exact: true })).toBeDisabled();
  await group.getByRole('radio', { name: /保留最新值/ }).check();
  await expect(dialog.locator('.diff-grid > section').last()).toContainText('已经合并的说明');
  await group.getByRole('radio', { name: /采用提案值/ }).check();
  await expect(dialog.locator('.diff-grid > section').last()).toContainText('提案中的说明');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/rebase-conflict-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  hub.confirm(update(repository.get(project.id)!.entity, { environmentName: '预览后的新修改' }).id);
  await dialog.getByRole('button', { name: '生成新提案', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('预览后又有变化');
  await expect(dialog.getByRole('button', { name: '生成新提案', exact: true })).toBeDisabled();
  expect(hub.request(source.id).status).toBe('pending');
  await dialog.getByRole('button', { name: '重新读取最新记录', exact: true }).click();
  await expect(group.getByRole('radio', { name: /采用提案值/ })).not.toBeChecked();
  await group.getByRole('radio', { name: /采用提案值/ }).check();
  const sent: string[] = [];
  await page.route('**/api/changes/*/rebase', async (route) => {
    if (route.request().method() === 'POST') {
      sent.push(route.request().postDataJSON().requestId);
      if (sent.length === 1) {
        await route.fetch();
        await route.abort('failed');
        return;
      }
    }
    await route.continue();
  });
  await dialog.getByRole('button', { name: '生成新提案', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('连接中断');
  expect(repository.get(project.id)!.entity).toMatchObject({
    description: '已经合并的说明',
    revision: 3,
  });
  await dialog.getByRole('button', { name: '生成新提案', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '确认变更提案', exact: true })).toBeVisible();
  expect(sent).toHaveLength(2);
  expect(sent[0]).toBe(sent[1]);
  await page.screenshot({
    path: 'test-results/rebase-confirmation.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(repository.get(project.id)!.entity.revision).toBe(3);
  await dialog.getByRole('button', { name: '确认并应用', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(repository.get(project.id)!.entity).toMatchObject({
    description: '提案中的说明',
    name: '新项目名称',
    status: 'paused',
    environmentName: '预览后的新修改',
    revision: 4,
  });
});

test('edited deletion targets require a choice and retained deletes leave additions pending', async ({
  page,
}) => {
  const source = hub.submit(
    {
      requestId: randomUUID(),
      operations: [
        { action: 'delete', id: project.id, expectedRevision: 1 },
        { action: 'create', entity: { kind: 'project', name: '新建记录' } },
      ],
    },
    'mcp',
  );
  hub.confirm(update(project, { description: '删除提案后的新内容' }).id);
  await openProposal(page, source.id);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: '生成新提案', exact: true })).toBeDisabled();
  await dialog.getByRole('radio', { name: '保留最新记录，取消这项删除', exact: true }).check();
  await dialog.getByRole('button', { name: '生成新提案', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '确认变更提案', exact: true })).toBeVisible();
  expect(hub.snapshot().entities).toHaveLength(1);
  expect(repository.get(project.id)!.deleted).toBe(false);
  await dialog.getByRole('button', { name: '确认并应用', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(hub.snapshot().entities).toHaveLength(2);
});

test('missing targets and historical bases show blockers without crashing the review', async ({
  page,
}) => {
  const source = hub.submit(
    {
      requestId: randomUUID(),
      operations: [{ action: 'delete', id: project.id, expectedRevision: 1 }],
    },
    'mcp',
  );
  const legacy = repository.request(source.id)!;
  delete legacy.request.baseEntities;
  repository.saveRequest(legacy.request, legacy.hash);
  hub.confirm(
    hub.submit(
      {
        requestId: randomUUID(),
        operations: [{ action: 'delete', id: project.id, expectedRevision: 1 }],
      },
      'web',
    ).id,
  );
  repository.db.prepare('DELETE FROM audit').run();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openProposal(page, source.id);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/目标记录不存在或已删除/)).toBeVisible();
  await expect(dialog.getByText(/无法恢复提案的原始基准/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: '生成新提案', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '返回原提案', exact: true }).click();
  expect(hub.request(source.id).status).toBe('pending');
  expect(errors).toEqual([]);
});

test('a generation retry recognizes a replacement already confirmed in another window', async ({
  page,
}) => {
  const source = update(project, { description: '其他窗口已确认的修改' });
  await openProposal(page, source.id);
  let interrupted = false;
  await page.route('**/api/changes/*/rebase', async (route) => {
    if (route.request().method() === 'POST' && !interrupted) {
      interrupted = true;
      const response = await route.fetch();
      const generated = await response.json();
      hub.confirm(generated.id);
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '生成新提案', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('连接中断');
  await dialog.getByRole('button', { name: '生成新提案', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('此新提案已经确认并应用，请核对最新记录。')).toBeVisible();
  expect(repository.get(project.id)!.entity).toMatchObject({
    description: '其他窗口已确认的修改',
    revision: 2,
  });
  expect(
    hub.snapshot().requests.filter((request) => request.rebasedFrom === source.id),
  ).toHaveLength(1);
});
