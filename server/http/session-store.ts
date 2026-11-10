import { createHash } from 'node:crypto';
import session from 'express-session';
import type { Repository } from '../infrastructure/database';

export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
export const sessionKey = (id: string) => createHash('sha256').update(id).digest('hex');

type Row = { data: string; expires_at: number; created_at: number; last_seen_at: number };
export class SqliteSessionStore extends session.Store {
  constructor(
    private repository: Repository,
    private now = Date.now,
  ) {
    super();
  }

  get(id: string, callback: (error: unknown, data?: session.SessionData | null) => void): void {
    try {
      const row = this.repository.db
        .prepare('SELECT * FROM web_sessions WHERE id=?')
        .get(sessionKey(id)) as Row | undefined;
      if (!row || row.expires_at <= this.now()) {
        this.destroy(id);
        callback(null, null);
        return;
      }
      callback(null, JSON.parse(row.data) as session.SessionData);
    } catch (error) {
      callback(error);
    }
  }
  set(id: string, data: session.SessionData, callback?: (error?: unknown) => void): void {
    try {
      const now = this.now();
      const key = sessionKey(id);
      const existing = this.repository.db
        .prepare('SELECT created_at FROM web_sessions WHERE id=?')
        .get(key) as { created_at: number } | undefined;
      const createdAt = data.createdAt ?? existing?.created_at ?? now;
      const expiresAt = Math.min(now + SESSION_IDLE_MS, createdAt + SESSION_ABSOLUTE_MS);
      this.repository.db.prepare('DELETE FROM web_sessions WHERE expires_at<=?').run(now);
      if (data.authenticated && data.authVersion !== this.repository.account()?.authVersion) {
        this.destroy(id);
        callback?.();
        return;
      }
      // Only regenerate creates an authenticated session. A revoked session must not be resurrected by a concurrent response.
      if (data.authenticated && !existing && !data.freshSession) {
        callback?.();
        return;
      }
      const stored = { ...data, createdAt, freshSession: false };
      this.repository.db
        .prepare(
          `INSERT INTO web_sessions(id,data,created_at,last_seen_at,expires_at,authenticated)
        VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,last_seen_at=excluded.last_seen_at,
        expires_at=excluded.expires_at,authenticated=excluded.authenticated`,
        )
        .run(key, JSON.stringify(stored), createdAt, now, expiresAt, Number(!!data.authenticated));
      data.freshSession = false;
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }
  destroy(id: string, callback?: (error?: unknown) => void): void {
    try {
      this.repository.db.prepare('DELETE FROM web_sessions WHERE id=?').run(sessionKey(id));
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }
  touch(id: string, data: session.SessionData, callback?: () => void): void {
    const now = this.now();
    this.repository.db
      .prepare(
        `UPDATE web_sessions SET last_seen_at=?,expires_at=MIN(?,created_at+?) WHERE id=? AND expires_at>?`,
      )
      .run(now, now + SESSION_IDLE_MS, SESSION_ABSOLUTE_MS, sessionKey(id), now);
    callback?.();
  }
  revokeAll(): void {
    this.repository.db.prepare('DELETE FROM web_sessions').run();
  }
  revoke(key: string): void {
    this.repository.db.prepare('DELETE FROM web_sessions WHERE id=?').run(key);
  }
  list(currentId: string) {
    const rows = this.repository.db
      .prepare(
        'SELECT id,created_at,last_seen_at,expires_at FROM web_sessions WHERE authenticated=1 AND expires_at>? ORDER BY created_at DESC',
      )
      .all(this.now()) as {
      id: string;
      created_at: number;
      last_seen_at: number;
      expires_at: number;
    }[];
    return rows.map((row) => ({
      id: row.id,
      current: row.id === sessionKey(currentId),
      createdAt: new Date(row.created_at).toISOString(),
      lastSeenAt: new Date(row.last_seen_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
    }));
  }
}
