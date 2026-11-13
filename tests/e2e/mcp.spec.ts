import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Repository } from '../../server/infrastructure/database';
import { HubService } from '../../server/application/hub';
import { createApp } from '../../server/http/app';
import { createMcpHandler } from '../../server/mcp/handler';
import { entityData, type ChangeRequest } from '../../shared/schema';

test('automatic MCP mutations appear in the web workspace and deletion can be undone', async ({
  page,
}) => {
  const repository = new Repository(':memory:');
  const hub = new HubService(repository);
  const token = 'isolated-browser-mcp-fixture-token-123456';
  const server = createServer(
    createApp({
      repository,
      mcpHandler: createMcpHandler(hub, token),
      disableRateLimit: true,
    }).app,
  );
  const client = new Client({ name: 'browser-mcp-fixture', version: '1.0.0' });
  server.keepAliveTimeout = 1;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url + '/mcp'), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    const submit = async (operations: unknown[]) => {
      const result = await client.callTool({
        name: 'hub_submit_batch',
        arguments: {
          requestId: randomUUID(),
          operations,
        },
      });
      expect(result.isError).not.toBe(true);
      const change = (result.structuredContent as { request: ChangeRequest }).request;
      expect(change.status).toBe('applied');
      return change;
    };
    const projectId = randomUUID();
    const created = await submit([
      { action: 'create', id: projectId, entity: { kind: 'project', name: '自动开发项目' } },
      { action: 'create', entity: { kind: 'task', projectId, title: 'AI 自动任务' } },
    ]);
    const task = created.result!.entities.find((entity) => entity.kind === 'task')!;
    await page.goto(url);
    await page.getByLabel('密码', { exact: true }).fill('isolated-mcp-browser-password');
    await page.getByLabel('确认密码', { exact: true }).fill('isolated-mcp-browser-password');
    await page.getByRole('button', { name: '创建工作空间', exact: true }).click();
    await page.getByRole('button', { name: '查看项目 →', exact: true }).click();
    await page.getByRole('tab', { name: /任务/ }).click();
    await expect(page.locator('.record').filter({ hasText: task.title })).toBeVisible();
    const edit = await submit([
      {
        action: 'update',
        id: task.id,
        expectedRevision: 1,
        entity: { ...entityData(task), title: 'AI 已完成任务', status: 'done' },
      },
    ]);
    await page.getByRole('button', { name: '刷新数据', exact: true }).click();
    await expect(page.locator('.record').filter({ hasText: 'AI 已完成任务' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(repository.requests().filter((r) => r.status === 'pending')).toHaveLength(0);
    expect(repository.auditEvent(edit.result!.auditId)?.confirmedBy).toBeNull();
    await submit([{ action: 'delete', id: task.id, expectedRevision: 2 }]);
    await page.getByRole('button', { name: '刷新数据', exact: true }).click();
    await expect(page.locator('.record')).toHaveCount(0);
    await page
      .getByRole('navigation', { name: '主导航' })
      .getByRole('button', { name: /操作历史/ })
      .click();
    const history = page.locator('.history-card').filter({
      has: page.getByRole('heading', { name: '删除「AI 已完成任务」', exact: true }),
    });
    await expect(history).toContainText('来源：MCP');
    await history.getByRole('button', { name: '预览撤销', exact: true }).click();
    expect(repository.get(task.id)?.deleted).toBe(true);
    await page.getByRole('button', { name: '确认并应用', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(repository.get(task.id)).toMatchObject({
      deleted: false,
      entity: { title: 'AI 已完成任务', revision: 4 },
    });
    await page
      .getByRole('navigation', { name: '主导航' })
      .getByRole('button', { name: /待确认变更/ })
      .click();
    await expect(page.getByText('没有待确认的变更', { exact: true })).toBeVisible();
  } finally {
    await client.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    repository.close();
  }
});
