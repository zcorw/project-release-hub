import { afterEach, beforeEach, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { Repository } from '../server/infrastructure/database';
import { HubService } from '../server/application/hub';
import { DeviceReports, createDeviceReportsRouter } from '../server/device/reports';

let repository: Repository, service: DeviceReports, app: express.Express;
let now: number, projectId: string, otherId: string;
const deviceId = randomUUID();
beforeEach(() => {
  repository = new Repository(':memory:');
  repository.createAccount('synthetic', 'synthetic');
  now = 1_800_000_000_000;
  const hub = new HubService(repository);
  const create = (entity: unknown) =>
    hub.submit({ requestId: randomUUID(), operations: [{ action: 'create', entity }] }, 'mcp')
      .result!.entities[0].id;
  projectId = create({
    kind: 'project',
    name: 'Allowed',
    repository: 'private/hidden',
    description: 'secret detail',
  });
  otherId = create({ kind: 'project', name: 'Other' });
  for (const id of [projectId, otherId]) {
    create({
      kind: 'task',
      projectId: id,
      title: 'Working',
      status: 'in_progress',
      description: 'secret task detail',
    });
    create({ kind: 'feature', projectId: id, title: 'Blocked feature', status: 'blocked' });
    create({ kind: 'issue', projectId: id, title: 'Open issue' });
    create({ kind: 'release', projectId: id, version: 'hidden version' });
  }
  service = new DeviceReports(repository, 'https://hub.example', () => now);
  app = express();
  app.use('/api/device/reports', createDeviceReportsRouter(service));
});
afterEach(() => repository.close());
const grant = () => service.createApprovedGrant({ deviceId, projectIds: [projectId] });
const read = (token: string) =>
  request(app).get('/api/device/reports').set('Authorization', `Bearer ${token}`);

it('serves only approved projects and minimized report fields over HTTP', async () => {
  const credential = grant();
  expect(credential.scope).toBe('reports:read');
  const response = await read(credential.token).expect(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body.entities).toHaveLength(4);
  expect(response.body.entities.map((e: { kind: string }) => e.kind).sort()).toEqual([
    'feature',
    'issue',
    'project',
    'task',
  ]);
  expect(JSON.stringify(response.body)).not.toMatch(/secret|private|hidden|Other/);
  for (const entity of response.body.entities) {
    expect(entity.kind === 'project' ? entity.id : entity.projectId).toBe(projectId);
    expect(Object.keys(entity).sort()).toEqual(
      (entity.kind === 'project'
        ? ['kind', 'id', 'name', 'status', 'updatedAt']
        : ['kind', 'id', 'projectId', 'title', 'status', 'updatedAt']
      ).sort(),
    );
  }
});
it('stores only a token digest and persists authorization across service instances', () => {
  const credential = grant();
  const row = repository.db.prepare('SELECT * FROM device_report_grants').get();
  expect(JSON.stringify(row)).not.toContain(credential.token);
  expect(
    new DeviceReports(repository, 'https://hub.example', () => now).read(credential.token),
  ).toBeDefined();
  expect(
    new DeviceReports(repository, 'https://other.example', () => now).read(credential.token),
  ).toBeUndefined();
});
it('rejects missing, malformed, unknown, query and browser-session credentials', async () => {
  await request(app).get('/api/device/reports').expect(401);
  await read('invalid').expect(401);
  await read('x'.repeat(43)).expect(401);
  await request(app)
    .get(`/api/device/reports?token=${grant().token}`)
    .set('Cookie', 'hub.sid=synthetic')
    .expect(401);
});
it('expires at the exact deadline and rechecks each request', async () => {
  const credential = grant();
  now = credential.expiresAt - 1;
  await read(credential.token).expect(200);
  now++;
  await read(credential.token).expect(401);
});
it('revokes every grant for an unbound device without revoking another device', async () => {
  const first = grant(),
    second = grant();
  const other = service.createApprovedGrant({ deviceId: randomUUID(), projectIds: [otherId] });
  service.revokeDevice(deviceId);
  await read(first.token).expect(401);
  await read(second.token).expect(401);
  await read(other.token).expect(200);
});
it('invalidates existing grants on password change', async () => {
  const credential = grant();
  repository.setPassword('new synthetic', 'new synthetic');
  await read(credential.token).expect(401);
});
it('never interprets empty, invalid or unknown project selection as all projects', () => {
  for (const projectIds of [[], ['bad'], [randomUUID()]])
    expect(() => service.createApprovedGrant({ deviceId, projectIds })).toThrow();
  expect(() =>
    service.createApprovedGrant({ deviceId, projectIds: [projectId], scope: 'hub:create' }),
  ).toThrow();
});
it('filters out records when an authorized project becomes deleted', async () => {
  const credential = grant();
  repository.put(repository.get(projectId)!.entity, true);
  const response = await read(credential.token).expect(200);
  expect(response.body.entities).toEqual([]);
});
it('rejects write methods even with a valid grant', async () => {
  const credential = grant();
  for (const method of ['post', 'put', 'patch', 'delete'] as const)
    await request(app)
      [method]('/api/device/reports')
      .set('Authorization', `Bearer ${credential.token}`)
      .expect(405);
});
it('requires an initialized account and canonical HTTPS issuer', () => {
  for (const issuer of [
    'http://hub.example',
    'https://hub.example/',
    'https://user@hub.example',
    'https://hub.example/path',
  ])
    expect(() => new DeviceReports(repository, issuer)).toThrow();
  const empty = new Repository(':memory:');
  try {
    expect(() =>
      new DeviceReports(empty, 'https://hub.example').createApprovedGrant({
        deviceId,
        projectIds: [projectId],
      }),
    ).toThrow('Account required');
  } finally {
    empty.close();
  }
});
