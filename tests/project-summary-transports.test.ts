import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterEach, beforeEach, expect, it } from 'vitest';
import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { HubService } from '../server/application/hub';
import { createApp } from '../server/http/app';
import { Repository } from '../server/infrastructure/database';
import { createMcpHandler } from '../server/mcp/handler';
import { entityData, type ChangeRequest, type Project } from '../shared/schema';

const token = 'isolated-project-summary-mcp-test-token-12345';
let repository: Repository,
  client: Client,
  server: Server,
  app: ReturnType<typeof createApp>['app'];

beforeEach(async () => {
  repository = new Repository(':memory:');
  app = createApp({
    repository,
    mcpHandler: createMcpHandler(new HubService(repository), token),
    disableRateLimit: true,
  }).app;
  server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('server address');
  client = new Client({ name: 'project-summary-integration', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
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

it('round-trips project introductions through real HTTP and MCP while retaining web confirmation', async () => {
  const agent = request.agent(app);
  const initial = await agent.get('/api/auth/status');
  const setup = await agent
    .post('/api/auth/setup')
    .set('X-CSRF-Token', initial.body.csrfToken)
    .send({ password: 'isolated-summary-test-password' });
  expect(setup.status).toBe(200);
  const csrf = setup.body.csrfToken as string;
  const description = 'Purpose and full task/commit/test/deployment history remain here.';
  const created = await agent
    .post('/api/changes')
    .set('X-CSRF-Token', csrf)
    .send({
      requestId: randomUUID(),
      operations: [
        {
          action: 'create',
          entity: {
            kind: 'project',
            name: 'Transport project',
            summary: '  Brief purpose  ',
            description,
          },
        },
      ],
    });
  expect(created.status).toBe(200);
  expect(created.body.status).toBe('applied');
  const project = created.body.result.entities[0] as Project;
  const listed = await client.callTool({
    name: 'hub_list_entities',
    arguments: { kind: 'project' },
  });
  expect(listed.isError).not.toBe(true);
  expect(listed.structuredContent).toMatchObject({
    entities: [{ id: project.id, summary: 'Brief purpose', description }],
  });
  const input = {
    requestId: randomUUID(),
    operations: [
      {
        action: 'update',
        id: project.id,
        expectedRevision: project.revision,
        entity: { ...entityData(project), summary: 'MCP introduction' },
      },
    ],
  };
  const written = await client.callTool({ name: 'hub_submit_batch', arguments: input });
  expect(written.isError).not.toBe(true);
  const applied = (written.structuredContent as { request: ChangeRequest }).request;
  expect(applied.status).toBe('applied');
  expect(
    (await client.callTool({ name: 'hub_submit_batch', arguments: input })).structuredContent,
  ).toEqual(written.structuredContent);
  const snapshot = await agent.get('/api/snapshot');
  expect(snapshot.body.entities).toMatchObject([
    { summary: 'MCP introduction', description, revision: 2 },
  ]);
  const current = snapshot.body.entities[0] as Project;
  const pending = await agent
    .post('/api/changes')
    .set('X-CSRF-Token', csrf)
    .send({
      requestId: randomUUID(),
      operations: [
        {
          action: 'update',
          id: project.id,
          expectedRevision: 2,
          entity: { ...entityData(current), summary: '' },
        },
      ],
    });
  expect(pending.status).toBe(200);
  expect(pending.body.status).toBe('pending');
  expect((await agent.get('/api/snapshot')).body.entities[0].summary).toBe('MCP introduction');
  const confirmed = await agent
    .post(`/api/changes/${pending.body.id}/confirm`)
    .set('X-CSRF-Token', csrf)
    .send({});
  expect(confirmed.body.status).toBe('applied');
  const reread = await client.callTool({
    name: 'hub_list_entities',
    arguments: { kind: 'project' },
  });
  expect(reread.structuredContent).toMatchObject({
    entities: [{ id: project.id, summary: '', description, revision: 3 }],
  });
  const invalid = await agent
    .post('/api/changes')
    .set('X-CSRF-Token', csrf)
    .send({
      requestId: randomUUID(),
      operations: [
        {
          action: 'create',
          entity: { kind: 'project', name: 'Invalid', summary: 'x'.repeat(501) },
        },
      ],
    });
  expect(invalid.status).toBe(400);
  expect((await agent.get('/api/snapshot')).body.entities).toHaveLength(1);
});
