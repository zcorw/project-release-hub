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
  it('lists bounded read/write tools and advertises destructive writes honestly', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      'hub_get_request',
      'hub_list_entities',
      'hub_list_pending',
      'hub_submit_batch',
    ]);
    expect(tools.tools.find((t) => t.name === 'hub_submit_batch')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
  });
  it('applies and replays additions, updates and deletes without web confirmation', async () => {
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
    const editInput = {
      requestId: randomUUID(),
      operations: [
        {
          action: 'update',
          id: project.id,
          expectedRevision: 1,
          entity: { ...entityData(project), description: 'Applied by MCP' },
        },
      ],
    };
    const edit = await client.callTool({ name: 'hub_submit_batch', arguments: editInput });
    const applied = (edit.structuredContent as { request: ChangeRequest }).request;
    expect(applied.status).toBe('applied');
    expect(repository.get(project.id)!.entity).toMatchObject({
      description: 'Applied by MCP',
      revision: 2,
    });
    expect(repository.auditEvent(applied.result!.auditId)).toMatchObject({
      actor: 'mcp-client',
      source: 'mcp',
      confirmedBy: null,
      changes: [{ before: project, afterRevision: 2 }],
    });
    expect(
      (await client.callTool({ name: 'hub_submit_batch', arguments: editInput })).structuredContent,
    ).toEqual(edit.structuredContent);
    expect(
      (
        await request(app)
          .post('/api/changes/' + applied.id + '/confirm')
          .set('Authorization', `Bearer ${token}`)
          .send({})
      ).status,
    ).toBe(401);
    const read = await client.callTool({
      name: 'hub_get_request',
      arguments: { requestId: applied.id },
    });
    expect((read.structuredContent as { request: ChangeRequest }).request.status).toBe('applied');
    const deleteInput = {
      requestId: randomUUID(),
      operations: [{ action: 'delete', id: project.id, expectedRevision: 2 }],
    };
    const deleted = await client.callTool({ name: 'hub_submit_batch', arguments: deleteInput });
    expect((deleted.structuredContent as { request: ChangeRequest }).request.status).toBe(
      'applied',
    );
    expect(repository.get(project.id)).toMatchObject({ deleted: true, entity: { revision: 3 } });
    expect(
      (await client.callTool({ name: 'hub_submit_batch', arguments: deleteInput }))
        .structuredContent,
    ).toEqual(deleted.structuredContent);
    expect(repository.history()).toHaveLength(3);
    const conflict = await client.callTool({
      name: 'hub_submit_batch',
      arguments: { ...deleteInput, operations: editInput.operations },
    });
    expect(conflict.structuredContent).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
    const list = await client.callTool({ name: 'hub_list_pending', arguments: {} });
    expect((list.structuredContent as { total: number }).total).toBe(0);
  });
  it('applies mixed batches and rejects stale revisions or dangling deletes atomically', async () => {
    const project = hub.submit(
      {
        requestId: randomUUID(),
        operations: [{ action: 'create', entity: { kind: 'project', name: 'Mixed batch' } }],
      },
      'mcp',
    ).result!.entities[0];
    const task = hub.submit(
      {
        requestId: randomUUID(),
        operations: [
          { action: 'create', entity: { kind: 'task', projectId: project.id, title: 'Old task' } },
        ],
      },
      'mcp',
    ).result!.entities[0];
    const input = {
      requestId: randomUUID(),
      operations: [
        { action: 'create', entity: { kind: 'issue', projectId: project.id, title: 'New issue' } },
        {
          action: 'update',
          id: project.id,
          expectedRevision: 1,
          entity: { ...entityData(project), description: 'Mixed update' },
        },
        { action: 'delete', id: task.id, expectedRevision: 1 },
      ],
    };
    const result = await client.callTool({ name: 'hub_submit_batch', arguments: input });
    const change = (result.structuredContent as { request: ChangeRequest }).request;
    expect(change.status).toBe('applied');
    expect(repository.auditEvent(change.result!.auditId)?.changes).toHaveLength(3);
    expect(
      repository
        .list()
        .map((e) => e.kind)
        .sort(),
    ).toEqual(['issue', 'project']);
    for (const [operation, code] of [
      [input.operations[1], 'REVISION_CONFLICT'],
      [{ action: 'delete', id: project.id, expectedRevision: 2 }, 'INVALID_REFERENCE'],
    ] as const) {
      const snapshot = hub.snapshot();
      const failed = await client.callTool({
        name: 'hub_submit_batch',
        arguments: {
          requestId: randomUUID(),
          operations: [
            { action: 'create', entity: { kind: 'project', name: 'Must roll back' } },
            operation,
          ],
        },
      });
      expect(failed.structuredContent).toMatchObject({ error: { code } });
      expect(hub.snapshot()).toEqual(snapshot);
    }
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
