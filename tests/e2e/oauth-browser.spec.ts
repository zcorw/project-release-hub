import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { Repository } from '../../server/infrastructure/database';
import { hashPassword } from '../../server/http/auth';
import { createApp } from '../../server/http/app';
import { OAuthService } from '../../server/oauth/service';

const listen = (server: Server) =>
  new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw Error('Missing address');
      resolve('http://127.0.0.1:' + address.port);
    });
  });
const stop = (server: Server) =>
  new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

test('real OAuth browser login, consent denial/allow, callback redirect and token exchange', async ({
  page,
}) => {
  const repository = new Repository(':memory:');
  const password = 'isolated-oauth-browser-password';
  const hashed = hashPassword(password);
  repository.createAccount(hashed.salt, hashed.hash);
  const oauth = new OAuthService(repository, { issuer: 'https://zhixu.example' });
  // Loopback transport for a real browser flow; no public TLS or user data.
  const app = createApp({ repository, oauth, disableRateLimit: true }).app;
  const backend = createServer(app);
  const callback = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>OAuth callback fixture</title><h1>Callback received</h1>');
  });
  try {
    const base = await listen(backend),
      callbackUrl = (await listen(callback)) + '/callback';
    const registration = oauth.register({
      client_name: 'Isolated browser client',
      redirect_uris: [callbackUrl],
    });
    const verifier = 'browser-test-pkce-verifier-'.repeat(3);
    const parameters = new URLSearchParams({
      client_id: registration.client_id,
      redirect_uri: callbackUrl,
      response_type: 'code',
      resource: oauth.resource,
      scope: 'hub:read hub:create hub:propose',
      state: 'opaque-browser-fixture-state',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    });
    const authorize = base + '/oauth/authorize?' + parameters;
    await page.goto(authorize);
    await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible();
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '进入工作空间', exact: true }).click();
    await expect(page.getByRole('heading', { name: '授权 MCP 应用', exact: true })).toBeVisible();
    await expect(page.getByText('Isolated browser client', { exact: true })).toBeVisible();
    await expect(
      page.getByText('hub:propose：直接修改或删除记录，无需逐次网页确认', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '拒绝', exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp('^' + callbackUrl.replace(/[.*+?^$()|[\]\\]/g, '\\$&')),
    );
    expect(new URL(page.url()).searchParams.get('error')).toBe('access_denied');
    expect(new URL(page.url()).searchParams.get('state')).toBe('opaque-browser-fixture-state');

    await page.goto(authorize);
    await expect(page.getByRole('heading', { name: '授权 MCP 应用', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '允许授权', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Callback received' })).toBeVisible();
    const code = new URL(page.url()).searchParams.get('code');
    expect(code).toBeTruthy();
    const response = await page.request.post(base + '/oauth/token', {
      form: {
        grant_type: 'authorization_code',
        client_id: registration.client_id,
        code: code!,
        redirect_uri: callbackUrl,
        code_verifier: verifier,
        resource: oauth.resource,
      },
    });
    expect(response.status()).toBe(200);
    const credentials = await response.json();
    expect(oauth.verifyAccessToken(credentials.access_token).scopes).toContain('hub:create');
    expect(
      JSON.stringify(repository.db.prepare('SELECT data FROM oauth_credentials').all()),
    ).not.toContain(credentials.access_token);
    await page.goto(base);
    await page.getByRole('button', { name: '账户与安全', exact: true }).click();
    await expect(
      page
        .getByRole('dialog')
        .getByText('OAuth 已启用。MCP 可在授权范围内直接修改、删除记录，无需逐次网页确认。', {
          exact: true,
        }),
    ).toBeVisible();
  } finally {
    await stop(backend);
    await stop(callback);
    repository.close();
  }
});
