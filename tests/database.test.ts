import { afterEach, describe, expect, it } from 'vitest';
import { Repository } from '../server/infrastructure/database';
import { projectSchema } from '../shared/schema';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
describe('SQLite persistence', () => {
  const opened: Repository[] = [];
  const paths: string[] = [];
  afterEach(() => {
    for (const db of opened) if (db.db.open) db.close();
    for (const path of paths) rmSync(path, { recursive: true, force: true });
  });
  it('persists records across restarts', () => {
    const path = mkdtempSync(join(tmpdir(), 'release-hub-'));
    paths.push(path);
    const filename = join(path, 'test.db');
    const db = new Repository(filename);
    opened.push(db);
    const record = {
      ...projectSchema.parse({ kind: 'project', name: 'Example' }),
      id: randomUUID(),
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.put(record);
    db.close();
    const reopened = new Repository(filename);
    opened.push(reopened);
    expect(reopened.list()).toEqual([record]);
  });
  it('rolls back failed transactions', () => {
    const db = new Repository(':memory:');
    opened.push(db);
    expect(() =>
      db.transaction(() => {
        db.createAccount('salt', 'hash');
        throw Error('rollback');
      }),
    ).toThrow();
    expect(db.account()).toBeUndefined();
  });
});
