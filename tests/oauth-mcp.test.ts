import { refreshAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';

import request, { type Test } from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Repository } from '../server/infrastructure/database';
import { HubService } from '../server/application/hub';
import { createApp } from '../server/http/app';
import { hashPassword } from '../server/http/auth';
import { entityData, type ChangeRequest } from '../shared/schema';
const issuer = 'https://hub.example',
  password = 'isolated-oauth-integration-password';
const security = {
  publicUrl: issuer,
  sessionSecret: 'isolated-session-secret-'.repeat(4),
  trustedProxies: ['127.0.0.1', '::1'],
};
const verifier = 'v'.repeat(43),
  challenge = createHash('sha256').update(verifier).digest('base64url');
let repository: Repository, app: ReturnType<typeof createApp>['app'];
let clients: Client[];
beforeEach(() => {
  repository = new Repository(':memory:');
  const hashed = hashPassword(password);
  repository.createAccount(hashed.salt, hashed.hash);
  app = createApp({ repository, security, disableRateLimit: true }).app;
  clients = [];
});
afterEach(async () => {
  for (const c of clients) await c.close();

  repository.close();
});
function proxy(test: Test) {
  return test.set('Host', 'hub.example').set('X-Forwarded-Proto', 'https');
}
function browser() {
  let cookie = '';
  return {
    async send(test: Test) {
      const result = await proxy(test).set('Cookie', cookie);
      const cookies = result.headers['set-cookie'] as unknown as string[] | undefined;
      if (cookies?.length) cookie = cookies.map((c) => c.split(';')[0]).join('; ');
      return result;
    },
    get cookie() {
      return cookie;
    },
  };
}
async function authorize(scope = 'hub:read hub:create hub:propose') {
  const registration = await proxy(request(app).post('/oauth/register')).send({
    client_name: 'SDK integration fixture',
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'none',
  });
  expect(registration.status).toBe(201);
  const clientId = registration.body.client_id as string;
  const web = browser();
  const started = await web.send(
    request(app)
      .get('/oauth/authorize')
      .query({
        client_id: clientId,
        redirect_uri: 'https://client.example/callback',
        response_type: 'code',
        resource: issuer + '/mcp',
        scope,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'fixture-state',
      }),
  );
  expect(started.status).toBe(303);
  const id = new URL(started.headers.location, issuer).searchParams.get('oauth_request')!;
  const status = await web.send(request(app).get('/api/auth/status'));
  const loggedIn = await web.send(
    request(app)
      .post('/api/auth/login')
      .set('X-CSRF-Token', status.body.csrfToken)
      .send({ password }),
  );
  expect(loggedIn.status).toBe(200);
  const csrf = loggedIn.body.csrfToken as string;
  const consent = await web.send(request(app).get('/oauth/authorize').query({ request_id: id }));
  expect(consent.status).toBe(200);
  expect(consent.text).toContain('SDK integration fixture');
  const allowed = await web.send(
    request(app)
      .post('/oauth/authorize')
      .type('form')
      .send({ request_id: id, decision: 'allow', csrfToken: csrf }),
  );
  expect(allowed.status).toBe(303);
  const callback = new URL(allowed.headers.location);
  expect(callback.searchParams.get('state')).toBe('fixture-state');
  const token = await proxy(request(app).post('/oauth/token'))
    .type('form')
    .send({
      grant_type: 'authorization_code',
      client_id: clientId,
      code: callback.searchParams.get('code'),
      redirect_uri: 'https://client.example/callback',
      code_verifier: verifier,
      resource: issuer + '/mcp',
    });
  expect(token.status).toBe(200);
  return {
    web,
    csrf,
    clientId,
    access: token.body.access_token as string,
    refresh: token.body.refresh_token as string,
  };
}
async function sdk(token: string) {
  const client = new Client({ name: 'oauth-integration-fixture', version: '1.0.0' });
  clients.push(client);
  // Supertest performs actual HTTP against Express; only DNS/TLS proxying is simulated.
  const fetcher: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    let test = proxy(request(app)[req.method.toLowerCase() as 'get' | 'post' | 'delete']('/mcp'));
    req.headers.forEach((value, name) => {
      if (name !== 'host') test = test.set(name, value);
    });
    const body = await req.text();
    const result = await (body ? test.send(body) : test);
    const headers = new Headers();
    for (const [name, value] of Object.entries(result.headers))
      if (value !== undefined)
        headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
    return new Response([204, 205, 304].includes(result.status) ? null : result.text, {
      status: result.status,
      headers,
    });
  };
  await client.connect(
    new StreamableHTTPClientTransport(new URL(issuer + '/mcp'), {
      fetch: fetcher,
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}
function mcp(token?: string) {
  let test = proxy(request(app).post('/mcp'))
    .set('Accept', 'application/json, text/event-stream')
    .set('MCP-Protocol-Version', '2025-03-26');
  if (token) test = test.set('Authorization', `Bearer ${token}`);
  return test.send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
}
describe('final app OAuth and MCP integration', () => {
  it('discovers canonical OAuth metadata via unauthenticated MCP challenge', async () => {
    const denied = await mcp();
    expect(denied.status).toBe(401);
    expect(denied.headers['www-authenticate']).toContain(
      `resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp"`,
    );
    const resource = await proxy(request(app).get('/.well-known/oauth-protected-resource/mcp'));
    expect(resource.body.resource).toBe(issuer + '/mcp');
    const auth = await proxy(request(app).get('/.well-known/oauth-authorization-server'));
    expect(auth.body.issuer).toBe(issuer);
    expect(auth.body.code_challenge_methods_supported).toEqual(['S256']);
  });
  it('uses actual login/consent/PKCE and never treats a web cookie as MCP authorization', async () => {
    const grant = await authorize();
    expect((await grant.web.send(request(app).post('/mcp').send({}))).status).toBe(401);
    const client = await sdk(grant.access);
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([
      'hub_get_request',
      'hub_list_entities',
      'hub_list_pending',
      'hub_submit_batch',
    ]);
    expect(
      (await grant.web.send(request(app).get('/api/account/security'))).body.grants[0].id,
    ).toBe(grant.clientId);
  });
  it('enforces read-only scopes before applying any writes', async () => {
    const grant = await authorize('hub:read'),
      client = await sdk(grant.access);
    expect((await client.callTool({ name: 'hub_list_entities', arguments: {} })).isError).not.toBe(
      true,
    );
    const result = await client.callTool({
      name: 'hub_submit_batch',
      arguments: {
        requestId: randomUUID(),
        operations: [{ action: 'create', entity: { kind: 'project', name: 'Blocked' } }],
      },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: 'INSUFFICIENT_SCOPE' } });
    expect(repository.list()).toHaveLength(0);
  });
  it('applies OAuth creates/edits/deletes directly while bearer cannot access web confirmation', async () => {
    const grant = await authorize(),
      client = await sdk(grant.access);
    const created = await client.callTool({
      name: 'hub_submit_batch',
      arguments: {
        requestId: randomUUID(),
        operations: [{ action: 'create', entity: { kind: 'project', name: 'OAuth MCP fixture' } }],
      },
    });
    expect((created.structuredContent as { request: ChangeRequest }).request.status).toBe(
      'applied',
    );
    const entity = repository.list()[0];
    for (const operation of [
      {
        action: 'update',
        id: entity.id,
        expectedRevision: entity.revision,
        entity: { ...entityData(entity), description: 'Direct OAuth update' },
      },
      { action: 'delete', id: entity.id, expectedRevision: entity.revision + 1 },
    ]) {
      const proposed = await client.callTool({
        name: 'hub_submit_batch',
        arguments: { requestId: randomUUID(), operations: [operation] },
      });
      const change = (proposed.structuredContent as { request: ChangeRequest }).request;
      expect(change.status).toBe('applied');
      expect(repository.auditEvent(change.result!.auditId)).toMatchObject({
        source: 'mcp',
        actor: 'mcp-client',
        confirmedBy: null,
      });
      expect(
        (
          await proxy(request(app).post(`/api/changes/${change.id}/confirm`))
            .set('Authorization', `Bearer ${grant.access}`)
            .send({})
        ).status,
      ).toBe(401);
    }
    expect(repository.get(entity.id)).toMatchObject({ deleted: true, entity: { revision: 3 } });
    expect(repository.requests().filter((r) => r.status === 'pending')).toHaveLength(0);
  });
  it('rejects ungranted updates/deletes and mixed batches for a create-only grant', async () => {
    const grant = await authorize('hub:create'),
      client = await sdk(grant.access);
    const created = await client.callTool({
      name: 'hub_submit_batch',
      arguments: {
        requestId: randomUUID(),
        operations: [{ action: 'create', entity: { kind: 'project', name: 'Only create' } }],
      },
    });
    expect(created.isError).not.toBe(true);
    const entity = repository.list()[0];
    expect((await client.callTool({ name: 'hub_list_entities', arguments: {} })).isError).toBe(
      true,
    );
    const denied = await client.callTool({
      name: 'hub_submit_batch',
      arguments: {
        requestId: randomUUID(),
        operations: [
          { action: 'create', entity: { kind: 'task', projectId: entity.id, title: 'Blocked' } },
          { action: 'delete', id: entity.id, expectedRevision: 1 },
        ],
      },
    });
    expect(denied.structuredContent).toMatchObject({ error: { code: 'INSUFFICIENT_SCOPE' } });
    const update = await client.callTool({
      name: 'hub_submit_batch',
      arguments: {
        requestId: randomUUID(),
        operations: [
          {
            action: 'update',
            id: entity.id,
            expectedRevision: 1,
            entity: { ...entityData(entity), description: 'Blocked' },
          },
        ],
      },
    });
    expect(update.structuredContent).toMatchObject({ error: { code: 'INSUFFICIENT_SCOPE' } });
    expect(repository.list()).toEqual([entity]);
    expect(repository.history()).toHaveLength(1);
    expect(repository.requests().filter((r) => r.status === 'pending')).toHaveLength(0);
  });
  it('retains direct-edit scope compatibility without allowing ungranted creates in mixed batches', async () => {
    const entity = new HubService(repository).submit(
      {
        requestId: randomUUID(),
        operations: [{ action: 'create', entity: { kind: 'project', name: 'Scoped update' } }],
      },
      'web',
    ).result!.entities[0];
    const grant = await authorize('hub:propose'),
      client = await sdk(grant.access);
    const operation = {
      action: 'update',
      id: entity.id,
      expectedRevision: 1,
      entity: { ...entityData(entity), description: 'Direct scope' },
    };
    const denied = await client.callTool({
      name: 'hub_submit_batch',
      arguments: {
        requestId: randomUUID(),
        operations: [
          operation,
          { action: 'create', entity: { kind: 'task', projectId: entity.id, title: 'Blocked' } },
        ],
      },
    });
    expect(denied.structuredContent).toMatchObject({ error: { code: 'INSUFFICIENT_SCOPE' } });
    expect(repository.list()).toEqual([entity]);
    const result = await client.callTool({
      name: 'hub_submit_batch',
      arguments: {
        requestId: randomUUID(),
        operations: [operation],
      },
    });
    expect(result.structuredContent).toMatchObject({ request: { status: 'applied' } });
    expect(repository.get(entity.id)?.entity).toMatchObject({
      revision: 2,
      description: 'Direct scope',
    });
  });
  it('revokes OAuth through the actual authenticated account UI endpoint', async () => {
    const grant = await authorize();
    expect((await mcp(grant.access)).status).toBe(200);
    const revoked = await grant.web.send(
      request(app)
        .post(`/api/account/grants/${grant.clientId}/revoke`)
        .set('X-CSRF-Token', grant.csrf)
        .send({}),
    );
    expect(revoked.status).toBe(200);
    expect((await mcp(grant.access)).status).toBe(401);
    const refreshed = await proxy(request(app).post('/oauth/token'))
      .type('form')
      .send({
        grant_type: 'refresh_token',
        client_id: grant.clientId,
        refresh_token: grant.refresh,
        resource: issuer + '/mcp',
      });
    expect(refreshed.status).toBe(400);
  });
  it('invalidates bearer and browser sessions after offline password reset', async () => {
    const grant = await authorize();
    const hashed = hashPassword('reset-only-in-memory-password');
    repository.setPassword(hashed.salt, hashed.hash);
    expect((await mcp(grant.access)).status).toBe(401);
    expect((await grant.web.send(request(app).get('/api/snapshot'))).status).toBe(401);
  });
  it('retains OAuth credentials and web sessions when app is recreated over the same database', async () => {
    const grant = await authorize();
    app = createApp({ repository, security, disableRateLimit: true }).app;
    expect((await mcp(grant.access)).status).toBe(200);
    expect((await grant.web.send(request(app).get('/api/snapshot'))).status).toBe(200);
    const renewed = await proxy(request(app).post('/oauth/token'))
      .type('form')
      .send({
        grant_type: 'refresh_token',
        client_id: grant.clientId,
        refresh_token: grant.refresh,
        resource: issuer + '/mcp',
      });
    expect(renewed.status).toBe(200);
  });
});

it('refreshes through the official SDK with the discovered bound resource', async () => {
  const grant = await authorize('hub:read');
  const metadata = (await proxy(request(app).get('/.well-known/oauth-authorization-server'))).body;
  const protectedMetadata = (
    await proxy(request(app).get('/.well-known/oauth-protected-resource/mcp'))
  ).body;
  let requestedResource: string | null = null;
  const tokens = await refreshAuthorization(issuer, {
    metadata,
    clientInformation: { client_id: grant.clientId },
    refreshToken: grant.refresh,
    resource: protectedMetadata.resource,
    fetchFn: async (input, init) => {
      const req = new Request(input, init);
      expect(req.url).toBe(issuer + '/oauth/token');
      const body = await req.text();
      requestedResource = new URLSearchParams(body).get('resource');
      const response = await proxy(request(app).post('/oauth/token'))
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(body);
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  expect(requestedResource).toBe(issuer + '/mcp');
  expect(tokens.refresh_token).not.toBe(grant.refresh);
  expect((await mcp(tokens.access_token)).status).toBe(200);
});
