import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { get as httpGet } from 'node:http';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const image = process.argv[2] ?? 'zhixu:ci';
const name = 'zhixu-smoke-' + randomUUID();
const volume = name + '-data';
let volumeCreated = false;
function docker(args, allowFailure = false) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 120000 });
  if (!allowFailure && (result.error || result.status !== 0))
    throw new Error(result.error?.message ?? result.stderr ?? 'Docker command failed.');
  return result.stdout?.trim() ?? '';
}
async function start(port = 4310) {
  docker([
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--publish',
    '127.0.0.1::' + port,
    '--env',
    'PORT=' + port,
    '--mount',
    'type=volume,source=' + volume + ',target=/app/data',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=64m',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    image,
  ]);
  const mapping = docker(['port', name, port + '/tcp']);
  assert.match(mapping, /^127\.0\.0\.1:\d+$/);
  const url = 'http://' + mapping;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(url + '/api/health');
      if (
        response.ok &&
        docker(['inspect', '--format', '{{.State.Health.Status}}', name]) === 'healthy'
      )
        return url;
    } catch {
      /* Wait for the isolated container to start. */
    }
    await delay(500);
  }
  throw new Error('Container did not become healthy: ' + docker(['logs', name], true));
}
try {
  docker(['volume', 'create', volume]);
  volumeCreated = true;
  let url = await start();
  assert.equal(docker(['exec', name, 'id', '-u']), '1000');
  assert.match(await (await fetch(url)).text(), /知序/);
  assert.equal((await fetch(url + '/api/snapshot')).status, 401);
  assert.equal((await fetch(url + '/mcp', { method: 'POST' })).status, 503);
  assert.equal(
    await new Promise((resolve, reject) => {
      httpGet(url + '/api/health', { headers: { Host: 'attacker.example' } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      }).on('error', reject);
    }),
    403,
  );
  const status = await fetch(url + '/api/auth/status');
  const initial = await status.json();
  assert.equal(initial.configured, false);
  const cookies = status.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
  const setup = await fetch(url + '/api/auth/setup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookies,
      'X-CSRF-Token': initial.csrfToken,
    },
    body: JSON.stringify({ password: 'isolated-container-' + randomUUID() }),
  });
  assert.equal(setup.status, 200);
  docker(['stop', name]);
  url = await start(4311);
  const restarted = await (await fetch(url + '/api/auth/status')).json();
  assert.equal(restarted.configured, true);
  assert.equal(restarted.authenticated, false);
  console.log(
    'Container passed: non-root, UI, health on default/custom ports, Host guard, auth, disabled MCP, SQLite persistence, and restart isolation.',
  );
} finally {
  docker(['rm', '--force', name], true);
  if (volumeCreated) docker(['volume', 'rm', volume]);
}
