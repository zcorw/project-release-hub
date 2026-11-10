import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type session from 'express-session';
import { Repository } from '../server/infrastructure/database';
import { createApp } from '../server/http/app';
import { hashPassword, verifyPassword } from '../server/http/auth';
import { securityConfig } from '../server/http/security';
import {
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  SqliteSessionStore,
} from '../server/http/session-store';
const password = 'account-integration-test-only';
const secret = 'test-only-session-secret-not-a-real-credential-'.repeat(2);
const repositories: Repository[] = [];
const dirs: string[] = [];
function repo(path = ':memory:') {
  const value = new Repository(path);
  repositories.push(value);
  return value;
}
afterEach(() => {
  for (const r of repositories.splice(0)) if (r.db.open) r.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
async function login(app: ReturnType<typeof createApp>['app'], setup = false) {
  const agent = request.agent(app);
  const status = await agent.get('/api/auth/status');
  const result = await agent
    .post('/api/auth/' + (setup ? 'setup' : 'login'))
    .set('X-CSRF-Token', status.body.csrfToken)
    .send({ password });
  expect(result.status).toBe(200);
  return {
    agent,
    csrf: result.body.csrfToken as string,
    cookie: result.headers['set-cookie'][0].split(';')[0],
  };
}
describe('persistent single-owner account security', () => {
  it('migrates v1 password hashes without resetting them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zhixu-account-migration-'));
    dirs.push(dir);
    const path = join(dir, 'hub.db');
    const old = new Database(path);
    const hashed = hashPassword(password);
    old.exec(
      'CREATE TABLE account(id INTEGER PRIMARY KEY CHECK(id=1),salt TEXT NOT NULL,hash TEXT NOT NULL); PRAGMA user_version=1;',
    );
    old.prepare('INSERT INTO account VALUES(1,?,?)').run(hashed.salt, hashed.hash);
    old.close();
    const migrated = repo(path);
    expect(migrated.account()).toEqual({ ...hashed, authVersion: 1 });
    expect(verifyPassword(password, migrated.account()!)).toBe(true);
    expect(migrated.db.pragma('user_version', { simple: true })).toBe(2);
  });
  it('retains authenticated sessions across process/repository restart with stable secret', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zhixu-session-restart-'));
    dirs.push(dir);
    const path = join(dir, 'hub.db');
    const repository = repo(path);
    const first = createApp({ repository, sessionSecret: secret, disableRateLimit: true });
    const signed = await login(first.app, true);
    repository.close();
    const second = createApp({
      repository: repo(path),
      sessionSecret: secret,
      disableRateLimit: true,
    });
    expect(
      (await request(second.app).get('/api/snapshot').set('Cookie', signed.cookie)).status,
    ).toBe(200);
    const incompatible = createApp({
      repository: second.hub.repository,
      sessionSecret: secret + 'changed',
      disableRateLimit: true,
    });
    expect(
      (await request(incompatible.app).get('/api/snapshot').set('Cookie', signed.cookie)).status,
    ).toBe(401);
  });
  it('requires CSRF and current password; rotates current session and revokes all other sessions', async () => {
    const repository = repo();
    const { app } = createApp({ repository, disableRateLimit: true });
    const first = await login(app, true),
      second = await login(app);
    const before = repository.account()!;
    expect(
      (
        await first.agent
          .post('/api/account/password')
          .send({ currentPassword: password, newPassword: password + 'new' })
      ).status,
    ).toBe(403);
    expect(
      (
        await first.agent
          .post('/api/account/password')
          .set('X-CSRF-Token', first.csrf)
          .send({ currentPassword: 'wrong', newPassword: password + 'new' })
      ).status,
    ).toBe(401);
    const result = await first.agent
      .post('/api/account/password')
      .set('X-CSRF-Token', first.csrf)
      .send({ currentPassword: password, newPassword: password + 'new' });
    expect(result.status).toBe(200);
    expect(result.body.authenticated).toBe(true);
    expect(result.body.csrfToken).not.toBe(first.csrf);
    expect(repository.account()!.authVersion).toBe(before.authVersion + 1);
    expect(verifyPassword(password + 'new', repository.account()!)).toBe(true);
    expect((await second.agent.get('/api/snapshot')).status).toBe(401);
    expect((await request(app).get('/api/snapshot').set('Cookie', first.cookie)).status).toBe(401);
    expect((await first.agent.get('/api/snapshot')).status).toBe(200);
    expect(
      (await first.agent.get('/api/account/security')).body.events.map(
        (e: { event: string }) => e.event,
      ),
    ).toContain('password_changed');
  });
  it('revokes individual sessions, current session, and all sessions server-side', async () => {
    const repository = repo();
    const { app } = createApp({ repository, disableRateLimit: true });
    const first = await login(app, true),
      second = await login(app);
    const sessions = (await first.agent.get('/api/account/security')).body.sessions as {
      id: string;
      current: boolean;
    }[];
    expect(sessions).toHaveLength(2);
    expect(
      (
        await first.agent
          .post('/api/account/sessions/' + sessions.find((s) => !s.current)!.id + '/revoke')
          .set('X-CSRF-Token', first.csrf)
          .send({})
      ).status,
    ).toBe(200);
    expect((await second.agent.get('/api/snapshot')).status).toBe(401);
    const all = await first.agent
      .post('/api/account/logout-all')
      .set('X-CSRF-Token', first.csrf)
      .send({});
    expect(all.body.authenticated).toBe(false);
    expect((await first.agent.get('/api/snapshot')).status).toBe(401);
    const third = await login(app);
    const current = (await third.agent.get('/api/account/security')).body.sessions[0];
    const currentRevoked = await third.agent
      .post('/api/account/sessions/' + current.id + '/revoke')
      .set('X-CSRF-Token', third.csrf)
      .send({});
    expect(currentRevoked.body.authenticated).toBe(false);
    expect((await third.agent.get('/api/snapshot')).status).toBe(401);
  });
  it('invalidates sessions after offline password reset and never returns password hashes', async () => {
    const repository = repo();
    const { app } = createApp({ repository, disableRateLimit: true });
    const signed = await login(app, true);
    const hashed = hashPassword(password + 'reset');
    const output = await signed.agent.get('/api/account/security');
    expect(JSON.stringify(output.body)).not.toContain(repository.account()!.hash);
    repository.setPassword(hashed.salt, hashed.hash);
    expect((await signed.agent.get('/api/snapshot')).status).toBe(401);
  });
  it('rejects cross-origin and body-only CSRF requests even with a session', async () => {
    const { app } = createApp({ repository: repo(), disableRateLimit: true });
    const signed = await login(app, true);
    expect(
      (
        await signed.agent
          .post('/api/auth/logout')
          .set('Origin', 'https://attacker.example')
          .set('X-CSRF-Token', signed.csrf)
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (await signed.agent.post('/api/auth/logout').send({ csrfToken: signed.csrf })).status,
    ).toBe(403);
    expect((await signed.agent.get('/api/snapshot')).status).toBe(200);
  });
});
describe('session storage limits', () => {
  it('enforces idle and absolute expiry and never resurrects a revoked authenticated session', () => {
    const repository = repo();
    const hashed = hashPassword(password);
    repository.createAccount(hashed.salt, hashed.hash);
    let now = 1000;
    const store = new SqliteSessionStore(repository, () => now);
    const data = {
      cookie: {} as session.Cookie,
      authenticated: true,
      authVersion: 1,
      createdAt: now,
      freshSession: true,
    } as session.SessionData;
    store.set('opaque-session-fixture', data);
    expect(data.freshSession).toBe(false);
    store.destroy('opaque-session-fixture');
    store.set('opaque-session-fixture', data);
    store.get('opaque-session-fixture', (error, value) => {
      expect(error).toBeNull();
      expect(value).toBeNull();
    });
    store.set('fresh', { ...data, freshSession: true });
    now += SESSION_IDLE_MS + 1;
    store.get('fresh', (_error, value) => expect(value).toBeNull());
    now = 1000;
    store.set('absolute', { ...data, freshSession: true });
    for (let i = 0; i < 20; i++) {
      now += SESSION_IDLE_MS - 100;
      store.touch('absolute', data);
    }
    expect(now).toBeGreaterThan(SESSION_ABSOLUTE_MS);
    store.get('absolute', (_error, value) => expect(value).toBeNull());
  });
});
describe('HTTPS origin and trusted proxy configuration', () => {
  const env = {
    HUB_PUBLIC_URL: 'https://zhixu.example',
    HUB_SESSION_SECRET: secret,
    HUB_TRUST_PROXY: '127.0.0.1,::1',
  };
  const secure = (app: ReturnType<typeof createApp>['app'], path: string) =>
    request(app).get(path).set('Host', 'zhixu.example').set('X-Forwarded-Proto', 'https');
  it('fails closed for invalid origin, secret, or unrestricted proxy trust', () => {
    for (const url of [
      'http://zhixu.example',
      'https://zhixu.example/a',
      'https://name@zhixu.example',
      'https://zhixu.example?x=1',
    ])
      expect(() => securityConfig({ ...env, HUB_PUBLIC_URL: url })).toThrow('HUB_PUBLIC_URL');
    expect(() => securityConfig({ ...env, HUB_SESSION_SECRET: 'short' })).toThrow(
      'HUB_SESSION_SECRET',
    );
    for (const value of [
      'true',
      '1',
      '0.0.0.0/0',
      '0.0.0.0/00',
      '::/0',
      'localhost',
      '127.0.0.1/33',
      '::1/129',
      '',
    ])
      expect(() => securityConfig({ ...env, HUB_TRUST_PROXY: value })).toThrow('HUB_TRUST_PROXY');
  });
  it('allows canonical Host only, never trusts forwarded Host or untrusted TLS claims', async () => {
    const { app } = createApp({
      repository: repo(),
      security: securityConfig(env),
      disableRateLimit: true,
    });
    expect((await secure(app, '/api/auth/status')).status).toBe(200);
    expect(
      (
        await request(app)
          .get('/api/auth/status')
          .set('Host', 'attacker.example')
          .set('X-Forwarded-Host', 'zhixu.example')
          .set('X-Forwarded-Proto', 'https')
      ).status,
    ).toBe(403);
    expect((await request(app).get('/api/auth/status').set('Host', 'zhixu.example')).status).toBe(
      400,
    );
    expect((await request(app).get('/api/health')).status).toBe(200);
    const untrusted = createApp({
      repository: repo(),
      security: securityConfig({ ...env, HUB_TRUST_PROXY: '10.1.1.1' }),
      disableRateLimit: true,
    }).app;
    expect((await secure(untrusted, '/api/auth/status')).status).toBe(400);
    expect((await secure(app, '/api/auth/status').set('Origin', 'null')).status).toBe(403);
  });
  it('uses secure host-only cookies and disables remotely claimable setup', async () => {
    const repository = repo();
    const { app } = createApp({
      repository,
      security: securityConfig(env),
      disableRateLimit: true,
    });
    const status = await secure(app, '/api/auth/status');
    const cookie = status.headers['set-cookie'][0];
    expect(cookie).toMatch(/^__Host-hub\.sid=/);
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Domain=');
    expect(status.body.setupAllowed).toBe(false);
    expect(status.body.oauthEnabled).toBe(true);
    const setup = await request(app)
      .post('/api/auth/setup')
      .set('Host', 'zhixu.example')
      .set('X-Forwarded-Proto', 'https')
      .set('Cookie', cookie.split(';')[0])
      .set('X-CSRF-Token', status.body.csrfToken)
      .send({ password });
    expect(setup.status).toBe(403);
    expect(repository.account()).toBeUndefined();
  });
});
