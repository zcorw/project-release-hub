import { afterEach, beforeEach, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { Repository } from '../server/infrastructure/database';
import { HubService } from '../server/application/hub';
import { DevicePairing, createDevicePairingRouter } from '../server/device/pairing';

let repository: Repository, service: DevicePairing, app: express.Express;
let now: number, projectId: string, otherId: string;
beforeEach(() => {
  repository = new Repository(':memory:');
  repository.createAccount('synthetic', 'synthetic');
  now = 1_800_000_000_000;
  const hub = new HubService(repository);
  const create = (entity: unknown) =>
    hub.submit({ requestId: randomUUID(), operations: [{ action: 'create', entity }] }, 'mcp')
      .result!.entities[0].id;
  projectId = create({ kind: 'project', name: 'Allowed' });
  otherId = create({ kind: 'project', name: 'Other' });
  create({ kind: 'task', projectId, title: 'Work', description: 'private details' });
  service = new DevicePairing(repository, 'https://hub.example', () => now);
  app = express();
  app.use(express.json());
  // Test-only stand-in for a production authenticated session AND CSRF guard.
  app.use(
    '/api/device',
    createDevicePairingRouter(service, (req, res, next) => {
      if (req.get('X-Test-Owner') !== 'synthetic' || req.get('X-Test-CSRF') !== 'synthetic') {
        res.sendStatus(403);
        return;
      }
      next();
    }),
  );
});
afterEach(() => repository.close());
const post = (path: string, body = {}) => request(app).post(`/api/device/${path}`).send(body);
const owner = (path: string, body: object) =>
  request(app)
    .post(`/api/device/${path}`)
    .set('X-Test-Owner', 'synthetic')
    .set('X-Test-CSRF', 'synthetic')
    .send(body);
const read = (token: string) =>
  request(app).get('/api/device/reports').set('Authorization', `Bearer ${token}`);
const bind = () => {
  const p = service.begin();
  service.approve({ requestId: p.requestId, projectIds: [projectId] });
  const claimed = service.claim(p.deviceSecret);
  return { ...claimed, ...service.confirm(claimed.refreshToken) };
};

it('runs synthetic HTTP pairing -> owner consent -> scoped report -> renewal -> unbind', async () => {
  const p = (await post('pair').expect(200)).body;
  await post('claim', { deviceSecret: p.deviceSecret }).expect(400);
  await owner('approve', { requestId: p.requestId, projectIds: [projectId] }).expect(200);
  const claimed = (await post('claim', { deviceSecret: p.deviceSecret }).expect(200)).body;
  await post('renew', { refreshToken: claimed.refreshToken }).expect(400);
  const c = {
    ...claimed,
    ...(await post('confirm', { refreshToken: claimed.refreshToken }).expect(200)).body,
  };
  const first = await read(c.token).expect(200);
  expect(first.headers['cache-control']).toBe('no-store');
  expect(first.body.entities).toHaveLength(2);
  expect(JSON.stringify(first.body)).not.toMatch(/Other|private/);
  now = c.expiresAt;
  await read(c.token).expect(401);
  const renewed = (await post('renew', { refreshToken: c.refreshToken }).expect(200)).body;
  await read(renewed.token).expect(200);
  await owner('unbind', { deviceId: c.deviceId }).expect(200);
  await read(renewed.token).expect(401);
  await post('renew', { refreshToken: c.refreshToken }).expect(400);
  expect(repository.securityEvents().map((e) => e.event)).toEqual(
    expect.arrayContaining(['device_pairing_approved', 'device_bound', 'device_unbound']),
  );
});
it('requires both synthetic owner identity and CSRF for approval and unbinding', async () => {
  const p = service.begin();
  const body = { requestId: p.requestId, projectIds: [projectId] };
  await post('approve', body).expect(403);
  await request(app)
    .post('/api/device/approve')
    .set('X-Test-Owner', 'synthetic')
    .send(body)
    .expect(403);
  await post('unbind', { deviceId: p.deviceId }).expect(403);
  expect(() => service.claim(p.deviceSecret)).toThrow();
});
it('does not accept public pairing ID, duplicate approval, repeat claim or scope expansion', () => {
  const p = service.begin();
  expect(() => service.claim(p.requestId)).toThrow();
  for (const projectIds of [[], [randomUUID()]])
    expect(() => service.approve({ requestId: p.requestId, projectIds })).toThrow();
  expect(() =>
    service.approve({ requestId: p.requestId, projectIds: [projectId], scope: 'hub:write' }),
  ).toThrow();
  service.approve({ requestId: p.requestId, projectIds: [projectId] });
  expect(() => service.approve({ requestId: p.requestId, projectIds: [otherId] })).toThrow();
  const claimed = service.claim(p.deviceSecret);
  service.confirm(claimed.refreshToken);
  expect(() => service.claim(p.deviceSecret)).toThrow();
});
it('invalidates unclaimed pairing at exact expiry, including approved requests', () => {
  const p = service.begin();
  service.approve({ requestId: p.requestId, projectIds: [projectId] });
  now = p.expiresAt;
  expect(() => service.claim(p.deviceSecret)).toThrow();
  expect(() => service.approve({ requestId: p.requestId, projectIds: [projectId] })).toThrow();
});
it('persists hashed renewal state across service restart without extending the deadline', () => {
  const c = bind();
  const restarted = new DevicePairing(repository, 'https://hub.example', () => now);
  const rows = JSON.stringify(repository.db.prepare('SELECT * FROM device_bindings').all());
  expect(rows).not.toContain(c.refreshToken);
  now = c.refreshExpiresAt - 1;
  expect(restarted.renew(c.refreshToken).scope).toBe('reports:read');
  now++;
  expect(() => restarted.renew(c.refreshToken)).toThrow();
});
it('invalidates pending pairings, renewal and access when account authentication changes', async () => {
  const c = bind(),
    p = service.begin();
  service.approve({ requestId: p.requestId, projectIds: [projectId] });
  repository.setPassword('new', 'new');
  expect(() => service.claim(p.deviceSecret)).toThrow();
  expect(() => service.renew(c.refreshToken)).toThrow();
  await read(c.token).expect(401);
});
it('binds pairing and renewal to canonical issuer; unbind also cancels approved pairing', () => {
  const c = bind(),
    p = service.begin();
  service.approve({ requestId: p.requestId, projectIds: [projectId] });
  const other = new DevicePairing(repository, 'https://other.example', () => now);
  expect(() => other.claim(p.deviceSecret)).toThrow();
  expect(() => other.renew(c.refreshToken)).toThrow();
  service.unbind(p.deviceId);
  expect(() => service.claim(p.deviceSecret)).toThrow();
  expect(service.renew(c.refreshToken)).toBeDefined();
});
it('does not widen grants when a selected project disappears', () => {
  const c = bind();
  repository.put(repository.get(projectId)!.entity, true);
  expect(() => service.renew(c.refreshToken)).toThrow();
  expect(service.reports.read(c.token)?.entities).toEqual([]);
});

it('recovers lost claim and confirmation responses after restart without ghost authorization', () => {
  const p = service.begin();
  service.approve({ requestId: p.requestId, projectIds: [projectId] });
  const first = service.claim(p.deviceSecret);
  expect(() => service.renew(first.refreshToken)).toThrow();
  const restarted = new DevicePairing(repository, 'https://hub.example', () => now);
  expect(restarted.claim(p.deviceSecret)).toEqual(first);
  const confirmed = restarted.confirm(first.refreshToken);
  expect(
    repository.db.prepare('SELECT replay_nonce FROM device_pairings WHERE id=?').get(p.requestId),
  ).toEqual({ replay_nonce: null });
  expect(() => restarted.claim(p.deviceSecret)).toThrow();
  expect(restarted.confirm(first.refreshToken).refreshExpiresAt).toBe(confirmed.refreshExpiresAt);
  expect(restarted.reports.read(confirmed.token)).toBeDefined();
});
it('expires unconfirmed bindings after five minutes without granting report access', () => {
  const p = service.begin();
  service.approve({ requestId: p.requestId, projectIds: [projectId] });
  const c = service.claim(p.deviceSecret);
  now = c.confirmationExpiresAt;
  expect(() => service.confirm(c.refreshToken)).toThrow();
  expect(() => service.claim(p.deviceSecret)).toThrow();
  expect(() => service.renew(c.refreshToken)).toThrow();
  expect(repository.db.prepare('SELECT count(*) AS n FROM device_report_grants').get()).toEqual({
    n: 0,
  });
});

it('starts the confirmation deadline at first claim, not initial pairing', () => {
  const p = service.begin();
  service.approve({ requestId: p.requestId, projectIds: [projectId] });
  now = p.expiresAt - 1;
  const c = service.claim(p.deviceSecret);
  expect(c.confirmationExpiresAt).toBe(now + 300_000);
  now += 1000;
  expect(service.claim(p.deviceSecret)).toEqual(c);
  expect(service.confirm(c.refreshToken).token).toBeDefined();
});
