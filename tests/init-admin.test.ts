import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import request from 'supertest';
import { Repository } from '../server/infrastructure/database';
import { createApp } from '../server/http/app';
import { verifyPassword } from '../server/http/auth';
import { securityConfig } from '../server/http/security';
import { projectSchema } from '../shared/schema';
import { initializeAdministrator } from '../scripts/init-admin';
import { readConfirmedPassword, readPasswordStdin } from '../scripts/lib/terminal-password';

const password = 'isolated-admin-test-password';
const opened: Repository[] = [];
const dirs: string[] = [];
function repo(path = ':memory:') {
  const repository = new Repository(path);
  opened.push(repository);
  return repository;
}
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'zhixu-init-admin-'));
  dirs.push(path);
  return path;
}
function cli(dir: string, args: string[] = [], input = '') {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', resolve('scripts/init-admin.ts'), ...args],
    { env: { ...process.env, HUB_DATA_DIR: dir }, input, encoding: 'utf8', timeout: 10000 },
  );
  expect(result.error).toBeUndefined();
  const output = result.stdout + result.stderr;
  expect(output).not.toContain(password);
  return { status: result.status, output };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const repository of opened.splice(0)) if (repository.db.open) repository.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('local administrator initialization', () => {
  it('uses the existing password hash and audit format without changing project records', () => {
    const repository = repo();
    const record = {
      ...projectSchema.parse({ kind: 'project', name: 'Preserved project' }),
      id: randomUUID(),
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    repository.put(record);
    initializeAdministrator(repository, password, password);
    expect(verifyPassword(password, repository.account()!)).toBe(true);
    expect(repository.account()!.hash).not.toContain(password);
    expect(repository.securityEvents().map((event) => event.event)).toEqual(['account_created']);
    expect(JSON.stringify(repository.securityEvents())).not.toContain(password);
    expect(repository.list()).toEqual([record]);
  });

  it.each(['short', 'x'.repeat(129)])('rejects invalid passwords without writes', (value) => {
    const repository = repo();
    expect(() => initializeAdministrator(repository, value, value)).toThrow('12-128');
    expect(repository.account()).toBeUndefined();
    expect(repository.securityEvents()).toEqual([]);
  });

  it('rejects mismatched confirmation without writes', () => {
    const repository = repo();
    expect(() => initializeAdministrator(repository, password, password + 'different')).toThrow(
      'do not match',
    );
    expect(repository.account()).toBeUndefined();
  });

  it('refuses to replace an existing owner and leaves authentication state unchanged', () => {
    const repository = repo();
    initializeAdministrator(repository, password, password);
    const before = repository.db.serialize();
    expect(() => initializeAdministrator(repository, password + 'new', password + 'new')).toThrow(
      'already exists',
    );
    expect(repository.db.serialize()).toEqual(before);
  });

  it('rolls back account insertion if the security event cannot be persisted', () => {
    const repository = repo();
    vi.spyOn(repository, 'securityEvent').mockImplementation(() => {
      throw Error('Simulated audit failure');
    });
    expect(() => initializeAdministrator(repository, password, password)).toThrow('audit failure');
    expect(repository.account()).toBeUndefined();
    expect(repository.securityEvents()).toEqual([]);
  });

  it('guards the insertion even when the preflight account read becomes stale', () => {
    const repository = repo();
    initializeAdministrator(repository, password, password);
    const before = repository.db.serialize();
    vi.spyOn(repository, 'account').mockReturnValueOnce(undefined);
    expect(() => initializeAdministrator(repository, password + 'new', password + 'new')).toThrow(
      'already exists',
    );
    expect(repository.db.serialize()).toEqual(before);
  });

  it('initializes the live HTTPS database without restart or enabling remote setup', async () => {
    const dir = directory();
    const repository = repo(join(dir, 'hub.db'));
    const { app } = createApp({
      repository,
      disableRateLimit: true,
      security: securityConfig({
        HUB_PUBLIC_URL: 'https://zhixu.example',
        HUB_SESSION_SECRET: 'isolated-session-secret-for-admin-test-'.repeat(2),
        HUB_TRUST_PROXY: '127.0.0.1,::1',
      }),
    });
    const getStatus = () =>
      request(app)
        .get('/api/auth/status')
        .set('Host', 'zhixu.example')
        .set('X-Forwarded-Proto', 'https');
    const before = await getStatus();
    expect(before.body.configured).toBe(false);
    expect(before.body.setupAllowed).toBe(false);
    expect(cli(dir, ['--password-stdin'], password + '\n').status).toBe(0);
    const status = await getStatus();
    expect(status.body.configured).toBe(true);
    expect(status.body.setupAllowed).toBe(false);
    const post = (route: string) =>
      request(app)
        .post('/api/auth/' + route)
        .set('Host', 'zhixu.example')
        .set('X-Forwarded-Proto', 'https')
        .set('Cookie', status.headers['set-cookie'][0].split(';')[0])
        .set('X-CSRF-Token', status.body.csrfToken)
        .send({ password });
    expect((await post('setup')).status).toBe(403);
    expect((await post('login')).status).toBe(200);
  });

  it('has help without touching a database; refuses a missing database and password arguments', () => {
    const dir = join(directory(), 'missing');
    expect(cli(dir, ['--help']).status).toBe(0);
    expect(cli(dir, ['--password-stdin'], password).output).toContain('database not found');
    expect(cli(dir, ['--password', password]).status).toBe(1);
    expect(existsSync(dir)).toBe(false);
  });

  it('requires explicit stdin mode and refuses repeated initialization before reading input', () => {
    const dir = directory();
    const repository = repo(join(dir, 'hub.db'));
    expect(cli(dir).output).toContain('interactive terminal');
    expect(repository.account()).toBeUndefined();
    expect(cli(dir, ['--password-stdin'], password + '\r\n').status).toBe(0);
    const before = { account: repository.account(), events: repository.securityEvents() };
    expect(cli(dir).output).toContain('already exists');
    expect({ account: repository.account(), events: repository.securityEvents() }).toEqual(before);
  });

  it.each(['', 'short', password + '\nextra', 'x'.repeat(2048)])(
    'rejects invalid stdin without creating an account or leaking input',
    (input) => {
      const dir = directory();
      const repository = repo(join(dir, 'hub.db'));
      expect(cli(dir, ['--password-stdin'], input).status).toBe(1);
      expect(repository.account()).toBeUndefined();
      expect(repository.securityEvents()).toEqual([]);
    },
  );
});

describe('password terminal input', () => {
  function terminal() {
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn() });
    const output = new PassThrough();
    let visible = '';
    output.on('data', (chunk) => (visible += chunk.toString()));
    return { input, output, visible: () => visible };
  }
  it('hides both entries, supports editing and restores terminal mode', async () => {
    const tty = terminal();
    const result = readConfirmedPassword(tty.input, tty.output);
    tty.input.write(password + 'x\u007f\r');
    await Promise.resolve();
    tty.input.write(password + '\r');
    expect(await result).toEqual({ password, confirmation: password });
    expect(tty.visible()).not.toContain(password);
    expect(tty.visible()).toContain('Confirm password');
    expect(tty.input.setRawMode.mock.calls.map((call) => call[0])).toEqual([true, false]);
  });
  it.each(['\u0003', '\u0004'])('cancels on Ctrl-C/EOF and restores terminal mode', async (key) => {
    const tty = terminal();
    const result = readConfirmedPassword(tty.input, tty.output);
    tty.input.write(key);
    await expect(result).rejects.toThrow('cancelled');
    expect(tty.input.setRawMode).toHaveBeenLastCalledWith(false);
  });
  it('does not trim significant password spaces from stdin', async () => {
    const input = new PassThrough();
    input.end('  ' + password + '  \n');
    expect(await readPasswordStdin(input)).toBe('  ' + password + '  ');
  });
});
