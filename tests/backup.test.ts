import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Repository } from '../server/infrastructure/database';
import { HubService } from '../server/application/hub';
it('makes a consistent online backup and refuses to overwrite it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'release-hub-backup-test-')),
    source = new Repository(join(directory, 'hub.db')),
    target = join(directory, 'backup.db');
  try {
    new HubService(source).submit(
      {
        requestId: randomUUID(),
        operations: [{ action: 'create', entity: { kind: 'project', name: 'Backup fixture' } }],
      },
      'web',
    );
    const run = () =>
      spawnSync(process.execPath, ['--import', 'tsx', resolve('scripts/backup.ts'), target], {
        env: { ...process.env, HUB_DATA_DIR: directory },
        encoding: 'utf8',
        windowsHide: true,
      });
    const first = run();
    expect(first.status, first.stderr).toBe(0);
    const restored = new Repository(target);
    try {
      expect(restored.list()).toEqual(source.list());
      expect(restored.history()).toEqual(source.history());
    } finally {
      restored.close();
    }
    const second = run();
    expect(second.status).not.toBe(0);
    expect(second.stderr).toContain('already exists');
  } finally {
    source.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
