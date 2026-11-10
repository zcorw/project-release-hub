import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { Repository } from '../server/infrastructure/database';
import { OAuthService, OAuthError, validRedirect } from '../server/oauth/service';
import { createOAuthRouter } from '../server/oauth/router';
let repository: Repository, service: OAuthService, now: number, client: string;
const redirect = 'https://client.example/callback',
  verifier = 'v'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');
beforeEach(() => {
  repository = new Repository(':memory:');
  repository.createAccount('test-salt', 'test-hash');
  now = 1_800_000_000_000;
  service = new OAuthService(repository, { issuer: 'https://hub.example', now: () => now });
  client = service.register({ client_name: 'Test client', redirect_uris: [redirect] }).client_id;
});
afterEach(() => repository.close());
function query(extra: Record<string, unknown> = {}) {
  return {
    client_id: client,
    redirect_uri: redirect,
    response_type: 'code',
    resource: service.resource,
    scope: 'hub:read hub:create hub:propose',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'client-state',
    ...extra,
  };
}
function code() {
  const id = service.begin(query());
  service.consent(id, '1', 'session');
  const location = service.decide(id, '1', 'session', true);
  return new URL(location).searchParams.get('code')!;
}
function exchange(value = code(), extra: Record<string, unknown> = {}) {
  return service.token({
    grant_type: 'authorization_code',
    client_id: client,
    code: value,
    redirect_uri: redirect,
    code_verifier: verifier,
    resource: service.resource,
    ...extra,
  });
}
function refresh(token: string, extra: Record<string, unknown> = {}) {
  return service.token({
    grant_type: 'refresh_token',
    client_id: client,
    refresh_token: token,
    resource: service.resource,
    ...extra,
  });
}
describe('OAuth provider isolated persistence and authorization', () => {
  it('requires a canonical HTTPS issuer', () => {
    for (const issuer of [
      'http://hub.example',
      'https://hub.example/',
      'https://hub.example/path',
      'https://u:p@hub.example',
    ])
      expect(() => new OAuthService(repository, { issuer })).toThrow();
  });
  it('accepts only exact HTTPS or loopback redirects', () => {
    for (const uri of [
      'https://client.example/cb',
      'http://127.0.0.1:123/cb',
      'http://[::1]:123/cb',
    ])
      expect(validRedirect(uri)).toBe(true);
    for (const uri of [
      'javascript:alert(1)',
      'http://evil.example/cb',
      'https://u:p@client.example/cb',
      'https://client.example/#x',
      'http://127.0.0.1.evil.example',
    ])
      expect(validRedirect(uri)).toBe(false);
  });
  it('rejects confidential clients and invalid metadata', () => {
    expect(() =>
      service.register({
        client_name: 'x',
        redirect_uris: [redirect],
        token_endpoint_auth_method: 'client_secret_basic',
      }),
    ).toThrow();
    expect(() =>
      service.register({ client_name: 'x', redirect_uris: ['http://evil.example'] }),
    ).toThrow();
  });
  it('requires registered exact redirect, resource, S256 and approved scopes', () => {
    for (const change of [
      { redirect_uri: redirect + '/' },
      { resource: 'https://other.example/mcp' },
      { code_challenge_method: 'plain' },
      { scope: 'hub:approve' },
      { code_challenge: 'short' },
      { resource: [service.resource] },
    ])
      expect(() => service.begin(query(change))).toThrow(OAuthError);
  });
  it('cannot exchange before explicit consent and binds consent to browser session', () => {
    const id = service.begin(query());
    expect(() => service.decide(id, '1', 'session', true)).toThrow();
    service.consent(id, '1', 'session');
    expect(() => service.decide(id, '1', 'other', true)).toThrow();
    expect(() => service.consent(id, '2', 'session')).toThrow();
    expect(() => service.consent(id, '1', 'other')).toThrow();
  });
  it('denial preserves state and issues no credentials', () => {
    const id = service.begin(query());
    service.consent(id, '1', 'session');
    const url = new URL(service.decide(id, '1', 'session', false));
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('client-state');
    expect(service.listGrants('1')).toEqual([]);
    expect(() => service.decide(id, '1', 'session', true)).toThrow();
  });
  it('expires consent and authorization code', () => {
    const id = service.begin(query());
    now += 600_001;
    expect(() => service.consent(id, '1', 'session')).toThrow();
    const value = code();
    now += 60_001;
    expect(() => exchange(value)).toThrow();
  });
  it('binds code to client, redirect, verifier and resource', () => {
    const value = code();
    for (const extra of [
      { redirect_uri: redirect + '/' },
      { code_verifier: 'z'.repeat(43) },
      { resource: 'https://other.example/mcp' },
      { client_id: 'unknown' },
    ])
      expect(() => exchange(value, extra)).toThrow();
    expect(exchange(value).token_type).toBe('Bearer');
  });
  it('hashes codes, access and refresh tokens and keeps audit secret-free', () => {
    const value = code(),
      tokens = exchange(value);
    const stored = JSON.stringify(repository.db.prepare('SELECT * FROM oauth_credentials').all());
    for (const secret of [value, tokens.access_token, tokens.refresh_token])
      expect(stored).not.toContain(secret);
    const audit = JSON.stringify(service.securityEvents('1'));
    expect(audit).not.toContain(tokens.access_token);
    expect(audit).toContain('token_issued');
    expect(service.verifyAccessToken(tokens.access_token).scopes).toEqual([
      'hub:read',
      'hub:create',
      'hub:propose',
    ]);
  });
  it('revokes the whole family when a code is replayed', () => {
    const value = code(),
      tokens = exchange(value);
    expect(() => exchange(value)).toThrow();
    expect(() => service.verifyAccessToken(tokens.access_token)).toThrow();
    expect(() => refresh(tokens.refresh_token)).toThrow();
  });
  it('rotates refresh credentials and revokes descendants on replay', () => {
    const first = exchange(),
      second = refresh(first.refresh_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(service.verifyAccessToken(second.access_token).clientId).toBe(client);
    expect(() => refresh(first.refresh_token)).toThrow();
    expect(() => service.verifyAccessToken(second.access_token)).toThrow();
    expect(() => refresh(second.refresh_token)).toThrow();
  });
  it('allows scope reduction but no escalation', () => {
    const first = exchange(),
      second = refresh(first.refresh_token, { scope: 'hub:read' });
    expect(second.scope).toBe('hub:read');
    expect(() => refresh(second.refresh_token, { scope: 'hub:create' })).toThrow();
    expect(() => refresh(second.refresh_token, { scope: 'hub:approve' })).toThrow();
  });
  it('expires access tokens and refresh tokens', () => {
    const tokens = exchange();
    now += 600_001;
    expect(() => service.verifyAccessToken(tokens.access_token)).toThrow();
    now += 7 * 24 * 3600_000;
    expect(() => refresh(tokens.refresh_token)).toThrow();
  });
  it('revokes grants without affecting unrelated clients', () => {
    const first = exchange();
    const other = service.register({ client_name: 'Other', redirect_uris: [redirect] }).client_id;
    client = other;
    const second = exchange();
    const firstClient = service
      .listGrants('1')
      .find((g) => g.clientName === 'Test client')!.clientId;
    service.revokeGrant('1', firstClient);
    expect(() => service.verifyAccessToken(first.access_token)).toThrow();
    expect(service.verifyAccessToken(second.access_token).clientId).toBe(other);
    expect(service.listGrants('1')).toHaveLength(1);
    service.revokeUser('1');
    expect(() => refresh(second.refresh_token)).toThrow();
    expect(service.listGrants('1')).toHaveLength(0);
  });
  it('revokes token family and gives success for unknown tokens', () => {
    const tokens = exchange();
    service.revoke({ client_id: client, token: 'unknown' });
    service.revoke({ client_id: client, token: tokens.refresh_token });
    expect(() => service.verifyAccessToken(tokens.access_token)).toThrow();
  });
  it('rejects tokens after account password version changes', () => {
    const tokens = exchange();
    repository.setPassword('new-salt', 'new-hash');
    expect(() => service.verifyAccessToken(tokens.access_token)).toThrow();
    expect(() => refresh(tokens.refresh_token)).toThrow();
  });
});
function app() {
  const a = express();
  a.use(
    session({
      secret: 'isolated-test-session-secret-value',
      resave: false,
      saveUninitialized: false,
    }),
  );
  a.get('/test-login', (req, res) => {
    req.session.authenticated = true;
    req.session.csrfToken = 'test-csrf';
    res.sendStatus(200);
  });
  a.use(
    createOAuthRouter({
      service,
      isAuthenticated: (req) => !!req.session.authenticated,
      authenticate: (req, res, next) => (req.session.authenticated ? next() : res.sendStatus(401)),
      csrf: (req, res, next) =>
        req.body.csrfToken === req.session.csrfToken ? next() : res.sendStatus(403),
      userId: () => '1',
      csrfToken: (req) => req.session.csrfToken!,
      disableRateLimit: true,
    }),
  );
  return a;
}
describe('OAuth HTTP discovery and consent', () => {
  it('publishes canonical metadata without reflecting host', async () => {
    const a = app();
    const result = await request(a)
      .get('/.well-known/oauth-authorization-server')
      .set('Host', 'evil.example');
    expect(result.body.issuer).toBe('https://hub.example');
    expect(result.body.code_challenge_methods_supported).toEqual(['S256']);
    expect((await request(a).get('/.well-known/oauth-protected-resource/mcp')).body.resource).toBe(
      service.resource,
    );
  });
  it('never redirects invalid authorize requests', async () => {
    const result = await request(app())
      .get('/oauth/authorize')
      .query(query({ redirect_uri: 'https://evil.example' }));
    expect(result.status).toBe(400);
    expect(result.headers.location).toBeUndefined();
  });
  it('preserves only opaque request through login, escapes consent and requires CSRF', async () => {
    client = service.register({
      client_name: '<script>alert(1)</script>',
      redirect_uris: [redirect],
    }).client_id;
    const agent = request.agent(app());
    const initial = await agent.get('/oauth/authorize').query(query());
    expect(initial.status).toBe(303);
    expect(initial.headers.location).toMatch(/^\/\?oauth_request=[\w-]+$/);
    const id = new URL(initial.headers.location, 'https://hub.example').searchParams.get(
      'oauth_request',
    )!;
    await agent.get('/test-login');
    const consent = await agent.get('/oauth/authorize').query({ request_id: id });
    expect(consent.text).toContain('&lt;script&gt;');
    expect(consent.text).not.toContain('<script>');
    expect(consent.headers['cache-control']).toBe('no-store');
    expect(
      (
        await agent
          .post('/oauth/authorize')
          .type('form')
          .send({ request_id: id, decision: 'allow' })
      ).status,
    ).toBe(403);
    const allowed = await agent
      .post('/oauth/authorize')
      .type('form')
      .send({ request_id: id, decision: 'allow', csrfToken: 'test-csrf' });
    expect(allowed.status).toBe(303);
    expect(new URL(allowed.headers.location).searchParams.has('code')).toBe(true);
  });
});

describe('OAuth additional security regressions', () => {
  it('rejects empty fragments and controls in redirects', () => {
    for (const uri of [
      'https://client.example/#',
      ' https://client.example/cb',
      'https://client.example/\ncb',
    ])
      expect(validRedirect(uri)).toBe(false);
  });
  it('persists authorization across service instances', () => {
    const tokens = exchange();
    const restarted = new OAuthService(repository, {
      issuer: 'https://hub.example',
      now: () => now,
    });
    expect(restarted.verifyAccessToken(tokens.access_token).clientId).toBe(client);
  });
  it('invalidates consent and codes after a password reset', () => {
    const value = code();
    const id = service.begin(query());
    service.consent(id, '1', 'session');
    repository.setPassword('new-salt', 'new-hash');
    expect(() => service.decide(id, '1', 'session', true)).toThrow();
    expect(() => exchange(value)).toThrow();
    expect(service.listGrants('1')).toEqual([]);
  });
  it('supports form token and revocation endpoints with no-store', async () => {
    const a = app();
    const result = await request(a).post('/oauth/token').type('form').send({
      grant_type: 'authorization_code',
      client_id: client,
      code: code(),
      redirect_uri: redirect,
      code_verifier: verifier,
      resource: service.resource,
    });
    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    const revoked = await request(a)
      .post('/oauth/revoke')
      .type('form')
      .send({ client_id: client, token: result.body.access_token });
    expect(revoked.status).toBe(200);
    expect(() => service.verifyAccessToken(result.body.access_token)).toThrow();
  });
  it('rate limits unauthenticated registrations', async () => {
    const a = express();
    a.use(
      createOAuthRouter({
        service,
        isAuthenticated: () => false,
        authenticate: (_req, res) => res.sendStatus(401),
        csrf: (_req, res) => res.sendStatus(403),
        userId: () => '1',
        csrfToken: () => '',
      }),
    );
    for (let i = 0; i < 20; i++)
      expect(
        (
          await request(a)
            .post('/oauth/register')
            .send({ client_name: 'Client', redirect_uris: [redirect] })
        ).status,
      ).toBe(201);
    expect(
      (
        await request(a)
          .post('/oauth/register')
          .send({ client_name: 'Client', redirect_uris: [redirect] })
      ).status,
    ).toBe(429);
  });
});

describe('OAuth storage bounds and usage', () => {
  it('accepts omitted optional client_name', () => {
    expect(service.register({ redirect_uris: [redirect] }).client_name).toBe(
      'Unnamed MCP application',
    );
  });
  it('caps clients and live consent requests', () => {
    repository.transaction(() => {
      const stmt = repository.db.prepare('INSERT INTO oauth_clients VALUES(?,?,?,?)');
      for (let i = 0; i < 999; i++) stmt.run('fixture-' + i, 'fixture', '[]', now);
    });
    expect(() => service.register({ redirect_uris: [redirect] })).toThrow('capacity');
    repository.transaction(() => {
      const stmt = repository.db.prepare('INSERT INTO oauth_intents VALUES(?,?,?)');
      for (let i = 0; i < 1000; i++) stmt.run('intent-' + i, '{}', now + 60_000);
    });
    expect(() => service.begin(query())).toThrow('capacity');
    now += 60_001;
    expect(service.begin(query())).toBeTruthy();
  });
  it('keeps expired refresh replay evidence while descendants are active', () => {
    const first = exchange();
    now += 6 * 24 * 3600_000;
    const second = refresh(first.refresh_token);
    now += 2 * 24 * 3600_000;
    const third = refresh(second.refresh_token);
    expect(() => refresh(first.refresh_token)).toThrow();
    expect(() => service.verifyAccessToken(third.access_token)).toThrow();
  });
  it('prunes expired credential families and unused old registrations', () => {
    exchange();
    now += 31 * 24 * 3600_000;
    service.register({ redirect_uris: [redirect] });
    expect(repository.db.prepare('SELECT count(*) AS n FROM oauth_credentials').get()).toEqual({
      n: 0,
    });
    expect(repository.db.prepare('SELECT count(*) AS n FROM oauth_clients').get()).toEqual({
      n: 2,
    });
    const unused = service.register({ redirect_uris: [redirect] }).client_id;
    now += 31 * 24 * 3600_000;
    service.begin(query());
    expect(
      repository.db.prepare('SELECT id FROM oauth_clients WHERE id=?').get(unused),
    ).toBeUndefined();
  });
  it('bounds audit retention and records successful grant usage only', () => {
    const tokens = exchange();
    expect(service.listGrants('1')[0].lastUsedAt).toBeNull();
    expect(() => service.verifyAccessToken('wrong')).toThrow();
    expect(service.listGrants('1')[0].lastUsedAt).toBeNull();
    service.verifyAccessToken(tokens.access_token);
    expect(service.listGrants('1')[0].lastUsedAt).toBe(now);
    for (let i = 0; i < 1010; i++) service.revokeGrant('1', 'absent');
    expect(repository.db.prepare('SELECT count(*) AS n FROM oauth_security_audit').get()).toEqual({
      n: 1000,
    });
    now += 91 * 24 * 3600_000;
    service.revokeGrant('1', 'absent');
    expect(repository.db.prepare('SELECT count(*) AS n FROM oauth_security_audit').get()).toEqual({
      n: 1,
    });
  });
  it('caps credentials without consuming an authorization code on failure', () => {
    const value = code();
    repository.transaction(() => {
      const stmt = repository.db.prepare(
        'INSERT INTO oauth_credentials(id,data,expires) VALUES(?,?,?)',
      );
      for (let i = 0; i < 19999; i++)
        stmt.run(
          'fixture-' + i,
          JSON.stringify({ kind: 'refresh', family: 'fixture-family' }),
          now + 60_000,
        );
    });
    expect(() => exchange(value)).toThrow('capacity');
    repository.db
      .prepare("DELETE FROM oauth_credentials WHERE json_extract(data,'$.family')='fixture-family'")
      .run();
    expect(exchange(value).access_token).toBeTruthy();
  });
});

describe('OAuth consent replacement and browser redirect policy', () => {
  it('replaces broad authority with read-only consent for the same client', () => {
    const first = exchange();
    const stale = service.begin(query());
    service.consent(stale, '1', 'session');
    const id = service.begin(query({ scope: 'hub:read' }));
    service.consent(id, '1', 'session');
    const url = new URL(service.decide(id, '1', 'session', true));
    expect(() => service.verifyAccessToken(first.access_token)).toThrow();
    expect(() => refresh(first.refresh_token)).toThrow();
    expect(() => service.decide(stale, '1', 'session', true)).toThrow();
    const second = exchange(url.searchParams.get('code')!);
    expect(service.verifyAccessToken(second.access_token).scopes).toEqual(['hub:read']);
    expect(service.listGrants('1')[0].scope).toBe('hub:read');
  });
  it('allows only the registered callback origin in form-action', async () => {
    client = service.register({
      client_name: 'Callback fixture',
      redirect_uris: ['http://127.0.0.1:43210/callback'],
    }).client_id;
    const agent = request.agent(app());
    await agent.get('/test-login');
    const response = await agent
      .get('/oauth/authorize')
      .query(query({ redirect_uri: 'http://127.0.0.1:43210/callback' }));
    expect(response.status).toBe(200);
    expect(response.headers['referrer-policy']).toBe('same-origin');
    expect(response.headers['content-security-policy']).toContain(
      "form-action 'self' http://127.0.0.1:43210;",
    );
    expect(response.text).toContain('替换此应用之前的授权');
    const invalid = await agent
      .get('/oauth/authorize')
      .query(query({ redirect_uri: 'https://unregistered.example/callback' }));
    expect(invalid.status).toBe(400);
    expect(invalid.headers['content-security-policy'] ?? '').not.toContain('unregistered.example');
  });
  it('rejects directive delimiters in redirect hostnames', () => {
    for (const value of [
      'https://evil.example;script-src/cb',
      "https://evil.example'unsafe-inline'/cb",
    ])
      expect(validRedirect(value)).toBe(false);
  });
});
