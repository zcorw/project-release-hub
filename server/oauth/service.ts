import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Repository } from '../infrastructure/database';

export const OAUTH_SCOPES = ['hub:read', 'hub:create', 'hub:propose'] as const;
const opaque = () => randomBytes(32).toString('base64url');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export class OAuthError extends Error {
  constructor(
    public error: string,
    message = 'Invalid OAuth request',
    public status = 400,
  ) {
    super(message);
  }
}
function fail(error = 'invalid_request', message?: string): never {
  throw new OAuthError(error, message);
}
export function field(input: Record<string, unknown>, name: string, required = true): string {
  const v = input[name];
  if (v === undefined && !required) return '';
  if (typeof v !== 'string' || !v || v.length > 2048) fail();
  return v;
}
function scopes(value: string): string[] {
  const result = [...new Set(value.split(' ').filter(Boolean))];
  if (!result.length || result.some((s) => !(OAUTH_SCOPES as readonly string[]).includes(s)))
    fail('invalid_scope');
  return result;
}
export function validRedirect(value: string) {
  try {
    if (/[\u0000-\u0020\u007f#]/.test(value)) return false;
    const u = new URL(value);
    return (
      /^[a-z0-9.\[\]:-]+$/i.test(u.hostname) &&
      !u.username &&
      !u.password &&
      !u.hash &&
      (u.protocol === 'https:' ||
        (u.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname)))
    );
  } catch {
    return false;
  }
}
type Client = { id: string; name: string; redirects: string };
type Intent = {
  clientId: string;
  redirect: string;
  scope: string;
  challenge: string;
  state: string;
  userId?: string;
  sessionHash?: string;
  version?: number;
};
type Credential = {
  kind: string;
  userId: string;
  clientId: string;
  scope: string;
  resource: string;
  family: string;
  version: number;
  redirect?: string;
  challenge?: string;
};
type Row<T> = { id: string; data: string; expires: number; used: number; value?: T };
export class OAuthService {
  readonly issuer: string;
  readonly resource: string;
  private now: () => number;
  constructor(
    private repository: Repository,
    options: { issuer: string; now?: () => number },
  ) {
    const u = new URL(options.issuer);
    if (u.protocol !== 'https:' || u.origin !== options.issuer || u.username || u.password)
      throw new Error('OAuth issuer must be a canonical HTTPS origin without a trailing slash');
    this.issuer = options.issuer;
    this.resource = `${this.issuer}/mcp`;
    this.now = options.now ?? Date.now;
    repository.db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, redirects TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_intents (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_credentials (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS oauth_grants (user_id TEXT NOT NULL, client_id TEXT NOT NULL, scope TEXT NOT NULL, created INTEGER NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(user_id,client_id));
      CREATE TABLE IF NOT EXISTS oauth_security_audit (id TEXT PRIMARY KEY, event TEXT NOT NULL, user_id TEXT, client_id TEXT, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS oauth_credentials_family ON oauth_credentials(json_extract(data,'$.family'));
    `);
    const columns = repository.db.prepare('PRAGMA table_info(oauth_grants)').all() as {
      name: string;
    }[];
    if (!columns.some((column) => column.name === 'last_used'))
      repository.db.exec('ALTER TABLE oauth_grants ADD COLUMN last_used INTEGER');
  }

  /** Keep consumed codes/refresh tokens while any usable descendant can still be revoked. */
  private maintenance() {
    const now = this.now();
    this.repository.db.prepare('DELETE FROM oauth_intents WHERE expires<=?').run(now);
    this.repository.db
      .prepare(
        `DELETE FROM oauth_credentials WHERE
      (json_extract(data,'$.kind')='access' AND (expires<=? OR used=1)) OR
      json_extract(data,'$.family') NOT IN (
        SELECT json_extract(data,'$.family') FROM oauth_credentials WHERE used=0 AND expires>?
      )`,
      )
      .run(now, now);
    this.repository.db
      .prepare(
        `DELETE FROM oauth_clients WHERE created<?
      AND id NOT IN (SELECT client_id FROM oauth_grants)
      AND id NOT IN (SELECT json_extract(data,'$.clientId') FROM oauth_intents)
      AND id NOT IN (SELECT json_extract(data,'$.clientId') FROM oauth_credentials)`,
      )
      .run(now - 30 * 24 * 3600_000);
  }
  private capacity(
    table: 'oauth_clients' | 'oauth_intents' | 'oauth_credentials',
    maximum: number,
  ) {
    const row = this.repository.db.prepare(`SELECT count(*) AS total FROM ${table}`).get() as {
      total: number;
    };
    if (row.total >= maximum)
      throw new OAuthError(
        'temporarily_unavailable',
        'OAuth storage capacity reached; revoke unused grants or retry after expiry.',
        503,
      );
  }
  private version() {
    const account = this.repository.account();
    if (!account) fail('invalid_grant', 'Account is not configured');
    return account.authVersion;
  }
  private audit(event: string, userId: string | null, clientId: string | null) {
    this.repository.db
      .prepare('INSERT INTO oauth_security_audit VALUES(?,?,?,?,?)')
      .run(randomUUID(), event, userId, clientId, this.now());
    this.repository.db
      .prepare(
        'DELETE FROM oauth_security_audit WHERE created < ? OR rowid NOT IN (SELECT rowid FROM oauth_security_audit ORDER BY created DESC, rowid DESC LIMIT 1000)',
      )
      .run(this.now() - 90 * 24 * 3600_000);
  }
  securityEvents(userId: string) {
    return this.repository.db
      .prepare(
        'SELECT id,event,client_id AS clientId,created AS createdAt FROM oauth_security_audit WHERE user_id=? ORDER BY created DESC LIMIT 100',
      )
      .all(userId) as { id: string; event: string; clientId: string | null; createdAt: number }[];
  }
  private client(id: string) {
    const c = this.repository.db.prepare('SELECT * FROM oauth_clients WHERE id=?').get(id) as
      Client | undefined;
    if (!c) fail('invalid_client');
    return c;
  }
  register(input: Record<string, unknown>) {
    this.maintenance();
    this.capacity('oauth_clients', 1000);
    const name =
        input.client_name === undefined ? 'Unnamed MCP application' : field(input, 'client_name'),
      redirects = input.redirect_uris;
    if (
      name.length > 120 ||
      !Array.isArray(redirects) ||
      !redirects.length ||
      redirects.length > 10 ||
      redirects.some((v) => typeof v !== 'string' || v.length > 2048 || !validRedirect(v))
    )
      fail('invalid_client_metadata');
    if (
      input.token_endpoint_auth_method !== undefined &&
      input.token_endpoint_auth_method !== 'none'
    )
      fail('invalid_client_metadata');
    if (
      input.grant_types !== undefined &&
      (!Array.isArray(input.grant_types) ||
        input.grant_types.some((v) => !['authorization_code', 'refresh_token'].includes(v)))
    )
      fail('invalid_client_metadata');
    if (
      input.response_types !== undefined &&
      (!Array.isArray(input.response_types) ||
        input.response_types.length !== 1 ||
        input.response_types[0] !== 'code')
    )
      fail('invalid_client_metadata');
    const id = randomUUID();
    this.repository.db
      .prepare('INSERT INTO oauth_clients VALUES(?,?,?,?)')
      .run(id, name, JSON.stringify([...new Set(redirects)]), this.now());
    this.audit('client_registered', null, id);
    return {
      client_id: id,
      client_name: name,
      redirect_uris: [...new Set(redirects)],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_id_issued_at: Math.floor(this.now() / 1000),
    };
  }
  begin(input: Record<string, unknown>) {
    this.maintenance();
    this.capacity('oauth_intents', 1000);
    const client = this.client(field(input, 'client_id')),
      redirect = field(input, 'redirect_uri');
    if (!(JSON.parse(client.redirects) as string[]).includes(redirect))
      fail('invalid_request', 'Unregistered redirect URI');
    if (field(input, 'response_type') !== 'code') fail('unsupported_response_type');
    if (field(input, 'resource') !== this.resource) fail('invalid_target');
    const challenge = field(input, 'code_challenge');
    if (field(input, 'code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge))
      fail('invalid_request', 'S256 PKCE is required');
    const value: Intent = {
      clientId: client.id,
      redirect,
      challenge,
      scope: scopes(field(input, 'scope')).join(' '),
      state: field(input, 'state', false),
    };
    const id = opaque();
    this.repository.db.prepare('DELETE FROM oauth_intents WHERE expires<=?').run(this.now());
    this.repository.db
      .prepare('INSERT INTO oauth_intents VALUES(?,?,?)')
      .run(hash(id), JSON.stringify(value), this.now() + 600_000);
    return id;
  }
  private intent(id: string) {
    const row = this.repository.db
      .prepare('SELECT * FROM oauth_intents WHERE id=?')
      .get(hash(id)) as Row<Intent> | undefined;
    if (!row || row.expires <= this.now()) fail('invalid_request', 'Consent request expired');
    return { row, value: JSON.parse(row.data) as Intent };
  }
  consent(id: string, userId: string, sessionId: string) {
    const { value } = this.intent(id),
      version = this.version();
    if (
      value.sessionHash &&
      (value.sessionHash !== hash(sessionId) ||
        value.userId !== userId ||
        value.version !== version)
    )
      fail('invalid_request', 'Consent session changed');
    Object.assign(value, { userId, sessionHash: hash(sessionId), version });
    this.repository.db
      .prepare('UPDATE oauth_intents SET data=? WHERE id=?')
      .run(JSON.stringify(value), hash(id));
    return {
      requestId: id,
      clientName: this.client(value.clientId).name,
      redirectUri: value.redirect,
      scopes: value.scope.split(' '),
    };
  }
  decide(id: string, userId: string, sessionId: string, approved: boolean) {
    this.maintenance();
    return this.repository.transaction(() => {
      const { value: v } = this.intent(id);
      if (v.userId !== userId || v.sessionHash !== hash(sessionId) || v.version !== this.version())
        fail('invalid_request', 'Consent session changed');
      this.repository.db.prepare('DELETE FROM oauth_intents WHERE id=?').run(hash(id));
      const target = new URL(v.redirect);
      if (v.state) target.searchParams.set('state', v.state);
      if (!approved) {
        target.searchParams.set('error', 'access_denied');
        this.audit('consent_denied', userId, v.clientId);
        return target.toString();
      }
      // A fresh explicit consent replaces this client's prior authority, including refresh families.
      this.repository.db
        .prepare(
          "UPDATE oauth_credentials SET used=1 WHERE json_extract(data,'$.userId')=? AND json_extract(data,'$.clientId')=?",
        )
        .run(userId, v.clientId);
      this.repository.db
        .prepare(
          "DELETE FROM oauth_intents WHERE json_extract(data,'$.userId')=? AND json_extract(data,'$.clientId')=?",
        )
        .run(userId, v.clientId);
      this.repository.db
        .prepare(
          'INSERT INTO oauth_grants(user_id,client_id,scope,created,version) VALUES(?,?,?,?,?) ON CONFLICT(user_id,client_id) DO UPDATE SET scope=excluded.scope,created=excluded.created,version=excluded.version,last_used=NULL',
        )
        .run(userId, v.clientId, v.scope, this.now(), v.version);
      const code = this.issue(
        {
          kind: 'code',
          userId,
          clientId: v.clientId,
          scope: v.scope,
          resource: this.resource,
          family: randomUUID(),
          version: v.version,
          redirect: v.redirect,
          challenge: v.challenge,
        },
        60_000,
      );
      target.searchParams.set('code', code);
      this.audit('consent_approved', userId, v.clientId);
      return target.toString();
    });
  }
  private issue(value: Credential, lifetime: number) {
    this.capacity('oauth_credentials', 20000);
    const token = opaque();
    this.repository.db
      .prepare('INSERT INTO oauth_credentials(id,data,expires) VALUES(?,?,?)')
      .run(hash(token), JSON.stringify(value), this.now() + lifetime);
    return token;
  }
  private credential(token: string) {
    const row = this.repository.db
      .prepare('SELECT * FROM oauth_credentials WHERE id=?')
      .get(hash(token)) as Row<Credential> | undefined;
    return row ? { row, value: JSON.parse(row.data) as Credential } : undefined;
  }
  private revokeFamily(family: string) {
    this.repository.db
      .prepare("UPDATE oauth_credentials SET used=1 WHERE json_extract(data,'$.family')=?")
      .run(family);
  }
  token(input: Record<string, unknown>) {
    this.maintenance();
    const clientId = field(input, 'client_id');
    this.client(clientId);
    if (field(input, 'resource') !== this.resource) fail('invalid_target');
    const type = field(input, 'grant_type');
    if (!['authorization_code', 'refresh_token'].includes(type)) fail('unsupported_grant_type');
    const stored = this.credential(
      field(input, type === 'authorization_code' ? 'code' : 'refresh_token'),
    );
    if (
      !stored ||
      stored.value.clientId !== clientId ||
      stored.value.kind !== (type === 'authorization_code' ? 'code' : 'refresh') ||
      stored.value.resource !== this.resource
    )
      fail('invalid_grant');
    const { row, value: v } = stored;
    if (row.used) {
      this.revokeFamily(v.family);
      this.audit('credential_replay_revoked', v.userId, clientId);
      fail('invalid_grant', 'Credential already used');
    }
    if (row.expires <= this.now() || v.version !== this.version()) fail('invalid_grant');
    if (type === 'authorization_code') {
      if (field(input, 'redirect_uri') !== v.redirect) fail('invalid_grant');
      const verifier = field(input, 'code_verifier');
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) fail('invalid_grant');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (!v.challenge || !timingSafeEqual(Buffer.from(challenge), Buffer.from(v.challenge)))
        fail('invalid_grant');
    }
    const scope = input.scope === undefined ? v.scope : scopes(field(input, 'scope')).join(' ');
    if (scope.split(' ').some((s) => !v.scope.split(' ').includes(s))) fail('invalid_scope');
    return this.repository.transaction(() => {
      if (
        !this.repository.db
          .prepare('UPDATE oauth_credentials SET used=1 WHERE id=? AND used=0')
          .run(row.id).changes
      )
        fail('invalid_grant');
      const access_token = this.issue(
        { ...v, scope, kind: 'access', redirect: undefined, challenge: undefined },
        600_000,
      );
      const refresh_token = this.issue(
        { ...v, scope, kind: 'refresh', redirect: undefined, challenge: undefined },
        7 * 24 * 3600_000,
      );
      this.audit(
        type === 'authorization_code' ? 'token_issued' : 'token_refreshed',
        v.userId,
        clientId,
      );
      return { access_token, refresh_token, token_type: 'Bearer', expires_in: 600, scope };
    });
  }
  verifyAccessToken(token: string) {
    const stored = token.length <= 2048 ? this.credential(token) : undefined;
    if (
      !stored ||
      stored.value.kind !== 'access' ||
      stored.row.used ||
      stored.row.expires <= this.now() ||
      stored.value.resource !== this.resource ||
      !this.repository.account() ||
      stored.value.version !== this.version()
    )
      throw new OAuthError('invalid_token', 'Invalid or expired bearer token', 401);
    const { value: v, row } = stored;
    this.repository.db
      .prepare('UPDATE oauth_grants SET last_used=? WHERE user_id=? AND client_id=?')
      .run(this.now(), v.userId, v.clientId);
    return {
      userId: v.userId,
      clientId: v.clientId,
      scopes: v.scope.split(' '),
      expiresAt: row.expires,
    };
  }
  revoke(input: Record<string, unknown>) {
    const id = field(input, 'client_id');
    this.client(id);
    const c = this.credential(field(input, 'token'));
    if (c && c.value.clientId === id) {
      this.revokeFamily(c.value.family);
      this.audit('token_revoked', c.value.userId, id);
    }
  }
  listGrants(userId: string) {
    return (
      this.repository.db
        .prepare(
          'SELECT client_id AS clientId,scope,created AS createdAt,last_used AS lastUsedAt FROM oauth_grants WHERE user_id=? AND version=? ORDER BY created DESC',
        )
        .all(userId, this.version()) as {
        clientId: string;
        scope: string;
        createdAt: number;
        lastUsedAt: number | null;
      }[]
    ).map((g) => ({ ...g, clientName: this.client(g.clientId).name, scopes: g.scope.split(' ') }));
  }
  revokeGrant(userId: string, clientId: string) {
    this.repository.transaction(() => {
      this.repository.db
        .prepare(
          "UPDATE oauth_credentials SET used=1 WHERE json_extract(data,'$.userId')=? AND json_extract(data,'$.clientId')=?",
        )
        .run(userId, clientId);
      this.repository.db
        .prepare(
          "DELETE FROM oauth_intents WHERE json_extract(data,'$.userId')=? AND json_extract(data,'$.clientId')=?",
        )
        .run(userId, clientId);
      this.repository.db
        .prepare('DELETE FROM oauth_grants WHERE user_id=? AND client_id=?')
        .run(userId, clientId);
      this.audit('grant_revoked', userId, clientId);
    });
  }
  revokeUser(userId: string) {
    this.repository.transaction(() => {
      this.repository.db
        .prepare("UPDATE oauth_credentials SET used=1 WHERE json_extract(data,'$.userId')=?")
        .run(userId);
      this.repository.db
        .prepare("DELETE FROM oauth_intents WHERE json_extract(data,'$.userId')=?")
        .run(userId);
      this.repository.db.prepare('DELETE FROM oauth_grants WHERE user_id=?').run(userId);
      this.audit('user_grants_revoked', userId, null);
    });
  }
}
