import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { Repository } from '../server/infrastructure/database';
import { createApp } from '../server/http/app';
import { HubService } from '../server/application/hub';
import { entityData } from '../shared/schema';
let repository: Repository, app: ReturnType<typeof createApp>['app'];
beforeEach(() => {
  repository = new Repository(':memory:');
  app = createApp({ repository, disableRateLimit: true }).app;
});
afterEach(() => repository.close());
async function signedIn() {
  const agent = request.agent(app);
  const initial = await agent.get('/api/auth/status');
  const setup = await agent
    .post('/api/auth/setup')
    .set('X-CSRF-Token', initial.body.csrfToken)
    .send({ password: 'local-test-only-password' });
  expect(setup.status).toBe(200);
  return { agent, csrf: setup.body.csrfToken as string };
}
describe('local authentication and HTTP writes', () => {
  it('requires login for snapshots and mutation routes', async () => {
    expect((await request(app).get('/api/snapshot')).status).toBe(401);
    expect((await request(app).post('/api/changes').send({})).status).toBe(401);
  });
  it('requires CSRF and a strong password for setup', async () => {
    const agent = request.agent(app);
    const status = await agent.get('/api/auth/status');
    expect(
      (await agent.post('/api/auth/setup').send({ password: 'long-test-password' })).status,
    ).toBe(403);
    expect(
      (
        await agent
          .post('/api/auth/setup')
          .set('X-CSRF-Token', status.body.csrfToken)
          .send({ password: 'short' })
      ).status,
    ).toBe(400);
    expect(repository.account()).toBeUndefined();
  });
  it('hashes the password, rotates the session, and allows logout/login', async () => {
    const { agent, csrf } = await signedIn();
    expect(repository.account()!.hash).not.toContain('local-test');
    expect((await agent.get('/api/snapshot')).status).toBe(200);
    const logout = await agent.post('/api/auth/logout').set('X-CSRF-Token', csrf).send({});
    expect((await agent.get('/api/snapshot')).status).toBe(401);
    expect(
      (
        await agent
          .post('/api/auth/login')
          .set('X-CSRF-Token', logout.body.csrfToken)
          .send({ password: 'wrong' })
      ).status,
    ).toBe(401);
    const login = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', logout.body.csrfToken)
      .send({ password: 'local-test-only-password' });
    expect(login.body.authenticated).toBe(true);
    expect(login.body.csrfToken).not.toBe(csrf);
  });
  it('cannot overwrite an already configured account', async () => {
    const { agent, csrf } = await signedIn();
    expect(
      (
        await agent
          .post('/api/auth/setup')
          .set('X-CSRF-Token', csrf)
          .send({ password: 'a-different-test-password' })
      ).status,
    ).toBe(409);
  });
  it('requires web confirmation and does not accept a bearer token instead', async () => {
    const { agent, csrf } = await signedIn();
    const create = await agent
      .post('/api/changes')
      .set('X-CSRF-Token', csrf)
      .send({
        requestId: randomUUID(),
        operations: [{ action: 'create', entity: { kind: 'project', name: 'HTTP project' } }],
      });
    const entity = create.body.result.entities[0];
    const pending = await agent
      .post('/api/changes')
      .set('X-CSRF-Token', csrf)
      .send({
        requestId: randomUUID(),
        operations: [{ action: 'delete', id: entity.id, expectedRevision: 1 }],
      });
    expect(pending.body.status).toBe('pending');
    expect((await agent.post('/api/changes/' + pending.body.id + '/confirm').send({})).status).toBe(
      403,
    );
    expect(
      (
        await request(app)
          .post('/api/changes/' + pending.body.id + '/confirm')
          .set('Authorization', 'Bearer test-only-token')
          .send({})
      ).status,
    ).toBe(401);
    expect(
      (
        await agent
          .post('/api/changes/' + pending.body.id + '/confirm')
          .set('X-CSRF-Token', csrf)
          .send({})
      ).body.status,
    ).toBe('applied');
    expect((await agent.get('/api/snapshot')).body.entities).toHaveLength(0);
  });
  it('rejects DNS-rebinding hosts and malformed inputs', async () => {
    expect(
      (await request(app).get('/api/auth/status').set('Host', 'attacker.example')).status,
    ).toBe(403);
    const { agent, csrf } = await signedIn();
    const bad = await agent
      .post('/api/changes')
      .set('X-CSRF-Token', csrf)
      .send({
        requestId: randomUUID(),
        operations: [{ action: 'create', entity: { kind: 'project', name: '' } }],
      });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
  it('keeps MCP disabled when not explicitly configured', async () => {
    expect((await request(app).post('/mcp').send({})).status).toBe(503);
  });
  it('keeps reconciliation behind web login/CSRF and requires separate application', async () => {
    const hub = new HubService(repository);
    const project = hub.submit(
      {
        requestId: randomUUID(),
        operations: [{ action: 'create', entity: { kind: 'project', name: 'Reconcile' } }],
      },
      'mcp',
    ).result!.entities[0];
    const source = hub.submit(
      {
        requestId: randomUUID(),
        operations: [
          {
            action: 'update',
            id: project.id,
            expectedRevision: 1,
            entity: { ...entityData(project), description: 'Wanted' },
          },
        ],
      },
      'mcp',
    );
    const path = '/api/changes/' + source.id + '/rebase';
    expect((await request(app).get(path)).status).toBe(401);
    expect(
      (await request(app).post(path).set('Authorization', 'Bearer test-only-token').send({}))
        .status,
    ).toBe(401);
    const { agent, csrf } = await signedIn();
    const preview = await agent.get(path);
    expect(preview.status).toBe(200);
    expect(preview.headers['cache-control']).toBe('no-store');
    const input = { requestId: randomUUID(), previewToken: preview.body.token, resolutions: [] };
    expect((await agent.post(path).send(input)).status).toBe(403);
    expect(
      (
        await agent
          .post(path)
          .set('X-CSRF-Token', csrf)
          .send({ ...input, operations: [] })
      ).status,
    ).toBe(400);
    const result = await agent.post(path).set('X-CSRF-Token', csrf).send(input);
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('pending');
    expect(repository.get(project.id)!.entity).toMatchObject({ description: '', revision: 1 });
    expect((await agent.post(path).set('X-CSRF-Token', csrf).send(input)).body).toEqual(
      result.body,
    );
    expect((await agent.post('/api/changes/' + result.body.id + '/confirm').send({})).status).toBe(
      403,
    );
    const confirmed = await agent
      .post('/api/changes/' + result.body.id + '/confirm')
      .set('X-CSRF-Token', csrf)
      .send({});
    expect(confirmed.body.status).toBe('applied');
    expect(repository.get(project.id)!.entity).toMatchObject({
      description: 'Wanted',
      revision: 2,
    });
  });
});
