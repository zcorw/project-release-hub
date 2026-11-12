import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Entity,
  EntityData,
  AuditEvent,
  ChangeRequest,
  ActionsSnapshot,
} from '../../shared/schema';
export type StoredEntity = { entity: Entity; deleted: boolean };
export class Repository {
  readonly db: Database.Database;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    const schemaVersion = this.db.pragma('user_version', { simple: true }) as number;
    if (schemaVersion > 2) {
      this.db.close();
      throw new Error('Database schema is newer than this application.');
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, project_id TEXT REFERENCES entities(id),
        revision INTEGER NOT NULL CHECK(revision>0), data TEXT NOT NULL CHECK(json_valid(data)),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1))
      );
      CREATE INDEX IF NOT EXISTS entities_project ON entities(project_id,kind,deleted);
      CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE IF NOT EXISTS actions (project_id TEXT PRIMARY KEY REFERENCES entities(id), data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE IF NOT EXISTS account (id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS web_sessions (
        id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)), created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, authenticated INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS web_sessions_expiry ON web_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS security_events (
        id TEXT PRIMARY KEY, event TEXT NOT NULL, created_at TEXT NOT NULL, detail TEXT
      );
    `);
    this.transaction(() => {
      const columns = this.db.prepare('PRAGMA table_info(account)').all() as { name: string }[];
      if (!columns.some((column) => column.name === 'auth_version'))
        this.db.exec('ALTER TABLE account ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1');
      this.db.pragma('user_version = 2');
    });
  }
  transaction<T>(work: () => T): T {
    return this.db.transaction(work)();
  }
  get(id: string): StoredEntity | undefined {
    const row = this.db.prepare('SELECT * FROM entities WHERE id=?').get(id) as
      | {
          data: string;
          id: string;
          revision: number;
          created_at: string;
          updated_at: string;
          deleted: number;
        }
      | undefined;
    if (!row) return undefined;
    return {
      entity: {
        ...(JSON.parse(row.data) as EntityData),
        id: row.id,
        revision: row.revision,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      deleted: row.deleted === 1,
    };
  }
  list(): Entity[] {
    const ids = this.db
      .prepare('SELECT id FROM entities WHERE deleted=0 ORDER BY created_at,id')
      .all() as { id: string }[];
    return ids.map(({ id }) => this.get(id)!.entity);
  }
  put(entity: Entity, deleted = false): void {
    const { id, revision, createdAt, updatedAt, ...data } = entity;
    this.db
      .prepare(
        `INSERT INTO entities(id,kind,project_id,revision,data,created_at,updated_at,deleted)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated_at=excluded.updated_at,deleted=excluded.deleted`,
      )
      .run(
        id,
        entity.kind,
        entity.kind === 'project' ? null : entity.projectId,
        revision,
        JSON.stringify(data),
        createdAt,
        updatedAt,
        Number(deleted),
      );
  }
  request(id: string): { hash: string; request: ChangeRequest } | undefined {
    const row = this.db.prepare('SELECT payload_hash,data FROM requests WHERE id=?').get(id) as
      { payload_hash: string; data: string } | undefined;
    return row
      ? { hash: row.payload_hash, request: JSON.parse(row.data) as ChangeRequest }
      : undefined;
  }
  saveRequest(request: ChangeRequest, hash: string): void {
    this.db
      .prepare(
        'INSERT INTO requests(id,payload_hash,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(request.id, hash, JSON.stringify(request));
  }
  requests(): ChangeRequest[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM requests WHERE json_extract(data,'$.status')='pending' OR id IN (SELECT id FROM requests ORDER BY rowid DESC LIMIT 100) ORDER BY rowid DESC",
        )
        .all() as { data: string }[]
    ).map((r) => JSON.parse(r.data) as ChangeRequest);
  }
  auditEvent(id: string): AuditEvent | undefined {
    const row = this.db.prepare('SELECT data FROM audit WHERE id=?').get(id) as
      { data: string } | undefined;
    return row ? (JSON.parse(row.data) as AuditEvent) : undefined;
  }
  entityRevision(id: string, revision: number): Entity | undefined {
    const current = this.get(id);
    if (current && !current.deleted && current.entity.revision === revision) return current.entity;
    // Search all audit snapshots, including events outside the UI's latest-100 window.
    const row = this.db
      .prepare(
        `
      SELECT json_extract(c.value, '$.before') AS snapshot
      FROM audit a, json_each(a.data, '$.changes') c
      WHERE json_extract(c.value, '$.id') = ?
        AND json_extract(c.value, '$.before.revision') = ?
      UNION ALL
      SELECT json_extract(c.value, '$.after') AS snapshot
      FROM audit a, json_each(a.data, '$.changes') c
      WHERE json_extract(c.value, '$.id') = ?
        AND json_extract(c.value, '$.after.revision') = ?
      LIMIT 1
    `,
      )
      .get(id, revision, id, revision) as { snapshot: string } | undefined;
    return row ? (JSON.parse(row.snapshot) as Entity) : undefined;
  }
  saveAudit(event: AuditEvent): void {
    this.db
      .prepare(
        'INSERT INTO audit(id,created_at,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(event.id, event.createdAt, JSON.stringify(event));
  }
  history(): AuditEvent[] {
    return (
      this.db.prepare('SELECT data FROM audit ORDER BY rowid DESC LIMIT 100').all() as {
        data: string;
      }[]
    ).map((r) => JSON.parse(r.data) as AuditEvent);
  }
  actions(): ActionsSnapshot[] {
    return (this.db.prepare('SELECT data FROM actions').all() as { data: string }[]).map(
      (r) => JSON.parse(r.data) as ActionsSnapshot,
    );
  }
  saveActions(snapshot: ActionsSnapshot): void {
    this.db
      .prepare(
        'INSERT INTO actions(project_id,data) VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET data=excluded.data',
      )
      .run(snapshot.projectId, JSON.stringify(snapshot));
  }
  account(): { salt: string; hash: string; authVersion: number } | undefined {
    return this.db
      .prepare('SELECT salt,hash,auth_version AS authVersion FROM account WHERE id=1')
      .get() as { salt: string; hash: string; authVersion: number } | undefined;
  }
  createAccount(salt: string, hash: string): boolean {
    return (
      this.db.prepare('INSERT OR IGNORE INTO account(id,salt,hash) VALUES(1,?,?)').run(salt, hash)
        .changes === 1
    );
  }
  setPassword(salt: string, hash: string): void {
    this.transaction(() => {
      this.db
        .prepare('UPDATE account SET salt=?,hash=?,auth_version=auth_version+1 WHERE id=1')
        .run(salt, hash);
      this.db.prepare('DELETE FROM web_sessions').run();
      this.securityEvent('password_changed');
    });
  }
  invalidateAuthentication(): void {
    this.db.prepare('UPDATE account SET auth_version=auth_version+1 WHERE id=1').run();
    this.db.prepare('DELETE FROM web_sessions').run();
  }
  securityEvent(event: string, detail?: string): void {
    this.db
      .prepare('INSERT INTO security_events(id,event,created_at,detail) VALUES(?,?,?,?)')
      .run(randomUUID(), event, new Date().toISOString(), detail ?? null);
    this.db
      .prepare(
        'DELETE FROM security_events WHERE id NOT IN (SELECT id FROM security_events ORDER BY rowid DESC LIMIT 1000)',
      )
      .run();
  }
  securityEvents() {
    return this.db
      .prepare(
        'SELECT id,event,created_at AS createdAt,detail FROM security_events ORDER BY rowid DESC LIMIT 100',
      )
      .all() as { id: string; event: string; createdAt: string; detail?: string }[];
  }
  close(): void {
    this.db.close();
  }
}
