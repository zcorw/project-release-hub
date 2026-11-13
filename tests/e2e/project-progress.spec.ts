import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { test, expect } from '@playwright/test';
import { Repository } from '../../server/infrastructure/database';
import { HubService } from '../../server/application/hub';
import { createApp } from '../../server/http/app';
import { entityData, type EntityData } from '../../shared/schema';
let repository: Repository, hub: HubService, server: Server, url: string;
function create(entity: EntityData) {
  return hub.submit({ requestId: randomUUID(), operations: [{ action: 'create', entity }] }, 'mcp')
    .result!.entities[0];
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
test('cards isolate work progress and reflect applied changes after refresh', async ({ page }) => {
  const parse = (entity: unknown) => entity as EntityData;
  const first = create(parse({ kind: 'project', name: '进度项目' }));
  const second = create(parse({ kind: 'project', name: '空白项目' }));
  const task = create(
    parse({ kind: 'task', projectId: first.id, title: '等待任务', status: 'todo' }),
  );
  create(parse({ kind: 'task', projectId: first.id, title: '完成任务', status: 'done' }));
  create(parse({ kind: 'issue', projectId: first.id, title: '关闭问题', status: 'closed' }));
  create(parse({ kind: 'issue', projectId: first.id, title: '待处理问题', status: 'open' }));
  await page.goto(url);
  await page.getByLabel('密码', { exact: true }).fill('isolated-progress-test-password');
  await page.getByLabel('确认密码', { exact: true }).fill('isolated-progress-test-password');
  await page.getByRole('button', { name: '创建工作空间', exact: true }).click();
  const card = page
    .locator('.project-card')
    .filter({ has: page.getByRole('button', { name: '进度项目', exact: true }) });
  await expect(card.getByRole('region', { name: '进度项目任务进度' })).toContainText(
    '1 / 2 已完成',
  );
  await expect(card.getByRole('region', { name: '进度项目问题进度' })).toContainText(
    '1 / 2 已解决或关闭',
  );
  const empty = page
    .locator('.project-card')
    .filter({ has: page.getByRole('button', { name: '空白项目', exact: true }) });
  await expect(empty).toContainText('暂无任务');
  await expect(empty).toContainText('暂无问题');
  hub.submit(
    {
      requestId: randomUUID(),
      operations: [
        {
          action: 'update',
          id: task.id,
          expectedRevision: task.revision,
          entity: { ...entityData(task), status: 'done' } as EntityData,
        },
      ],
    },
    'mcp',
  );
  await page.reload();
  await expect(card.getByRole('region', { name: '进度项目任务进度' })).toContainText(
    '2 / 2 已完成',
  );
  await expect(card.getByRole('progressbar', { name: '进度项目任务进度' })).toHaveAttribute(
    'aria-valuenow',
    '2',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card.getByRole('region', { name: '进度项目问题进度' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(second.id).not.toBe(first.id);
});
