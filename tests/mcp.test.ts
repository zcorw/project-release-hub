import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import request from 'supertest';
import { Repository } from '../server/infrastructure/database';
import { HubService } from '../server/application/hub';
import { createApp } from '../server/http/app';
import { createMcpHandler } from '../server/mcp/handler';
import { entityData, type ChangeRequest } from '../shared/schema';
const token = 'fixture-mcp-token-only-not-a-real-secret-12345';
let repository: Repository,
  hub: HubService,
  client: Client,
  server: Server,
  url: string,
  app: ReturnType<typeof createApp>['app'];
beforeEach(async () => {
  repository = new Repository(':memory:');
  hub = new HubService(repository);
  app = createApp({
    repository,
    mcpHandler: createMcpHandler(hub, token),
    disableRateLimit: true,
  }).app;
  server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('server address');
  url = `http://127.0.0.1:${address.port}/mcp`;
  client = new Client({ name: 'integration-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
});
afterEach(async () => {
  await client.close();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  repository.close();
});
describe('MCP Streamable HTTP boundary', () => {
  it('lists only bounded read and proposal tools, never approval tools', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      'hub_get_request',
      'hub_list_entities',
      'hub_list_pending',
      'hub_submit_batch',
    ]);
  });
  it('applies idempotent additions and reports updates as pending', async () => {
    const input = {
      requestId: randomUUID(),
      operations: [{ action: 'create', entity: { kind: 'project', name: 'MCP sample' } }],
    };
    const result = await client.callTool({ name: 'hub_submit_batch', arguments: input });
    expect(result.isError).not.toBe(true);
    const change = (result.structuredContent as { request: ChangeRequest }).request;
    expect(change.status).toBe('applied');
    await client.callTool({ name: 'hub_submit_batch', arguments: input });
    expect(repository.list()).toHaveLength(1);
    const project = repository.list()[0];
    const edit = await client.callTool({
      name: 'hub_submit_batch',
      arguments: {
        requestId: randomUUID(),
        operations: [
          {
            action: 'update',
            id: project.id,
            expectedRevision: 1,
            entity: { ...entityData(project), description: 'Proposed by MCP' },
          },
        ],
      },
    });
    const pending = (edit.structuredContent as { request: ChangeRequest }).request;
    expect(pending.status).toBe('pending');
    expect(repository.get(project.id)!.entity).toEqual(project);
    expect(
      (
        await request(app)
          .post('/api/changes/' + pending.id + '/confirm')
          .set('Authorization', `Bearer ${token}`)
          .send({})
      ).status,
    ).toBe(401);
    const read = await client.callTool({
      name: 'hub_get_request',
      arguments: { requestId: pending.id },
    });
    expect((read.structuredContent as { request: ChangeRequest }).request.status).toBe('pending');
    const list = await client.callTool({ name: 'hub_list_pending', arguments: {} });
    expect((list.structuredContent as { total: number }).total).toBe(1);
  });
  it('requires duplicate project clarification and never silently creates it', async () => {
    const call = () =>
      client.callTool({
        name: 'hub_submit_batch',
        arguments: {
          requestId: randomUUID(),
          operations: [{ action: 'create', entity: { kind: 'project', name: 'Same project' } }],
        },
      });
    await call();
    const duplicate = await call();
    expect((duplicate.structuredContent as { request: ChangeRequest }).request.status).toBe(
      'pending',
    );
    expect(repository.list()).toHaveLength(1);
  });
  it('enforces authentication without exposing the configured token', async () => {
    const missing = await request(app).post('/mcp').send({});
    expect(missing.status).toBe(401);
    expect(JSON.stringify(missing.body)).not.toContain(token);
    const wrong = await request(app).post('/mcp').set('Authorization', 'Bearer wrong').send({});
    expect(wrong.status).toBe(401);
    const method = await request(app).get('/mcp').set('Authorization', `Bearer ${token}`);
    expect(method.status).toBe(405);
  });
  it('returns errors without partially applying invalid batches', async () => {
    const result = await client.callTool({
      name: 'hub_submit_batch',
      arguments: {
        requestId: randomUUID(),
        operations: [
          { action: 'create', entity: { kind: 'project', name: 'Valid' } },
          { action: 'create', entity: { kind: 'task', projectId: randomUUID(), title: 'Orphan' } },
        ],
      },
    });
    expect(result.isError).toBe(true);
    expect(repository.list()).toHaveLength(0);
  });
});
