import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { Entity } from '../../shared/schema';
import type { Repository } from '../infrastructure/database';

const selection = z
  .object({
    deviceId: z.uuid(),
    projectIds: z.array(z.uuid()).min(1).max(100),
  })
  .strict();
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const lifetime = 15 * 60 * 1000;
type Grant = {
  id: string;
  device_id: string;
  project_ids: string;
  resource: string;
  expires_at: number;
  auth_version: number;
  revoked: number;
};

type ReportEntity =
  | Pick<Extract<Entity, { kind: 'project' }>, 'kind' | 'id' | 'name' | 'status' | 'updatedAt'>
  | Pick<
      Extract<Entity, { kind: 'task' | 'feature' | 'issue' }>,
      'kind' | 'id' | 'projectId' | 'title' | 'status' | 'updatedAt'
    >;

/** Opt-in foundation. No production caller or public issuance route exists yet. */
export class DeviceReports {
  readonly resource: string;
  constructor(
    private repository: Repository,
    issuer: string,
    private now = Date.now,
  ) {
    const url = new URL(issuer);
    if (url.protocol !== 'https:' || url.origin !== issuer || url.username || url.password)
      throw new Error('Canonical HTTPS issuer required');
    this.resource = `${issuer}/api/device/reports`;
    repository.db.exec(`CREATE TABLE IF NOT EXISTS device_report_grants (
      id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, device_id TEXT NOT NULL,
      project_ids TEXT NOT NULL, resource TEXT NOT NULL, expires_at INTEGER NOT NULL,
      auth_version INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
    )`);
  }

  /** Trusted-only boundary: caller must first obtain owner consent for this exact selection. */
  createApprovedGrant(input: unknown) {
    const { deviceId, projectIds } = selection.parse(input);
    const account = this.repository.account();
    if (!account) throw new Error('Account required');
    for (const id of projectIds) {
      const project = this.repository.get(id);
      if (!project || project.deleted || project.entity.kind !== 'project')
        throw new Error('Unknown project');
    }
    const id = randomUUID(),
      token = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + lifetime;
    this.repository.db
      .prepare(
        `INSERT INTO device_report_grants
      (id, token_hash, device_id, project_ids, resource, expires_at, auth_version)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        digest(token),
        deviceId,
        JSON.stringify([...new Set(projectIds)]),
        this.resource,
        expiresAt,
        account.authVersion,
      );
    return { id, token, scope: 'reports:read' as const, expiresAt, resource: this.resource };
  }

  revokeDevice(deviceId: string) {
    z.uuid().parse(deviceId);
    this.repository.db
      .prepare('UPDATE device_report_grants SET revoked=1 WHERE device_id=?')
      .run(deviceId);
  }

  read(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const grant = this.repository.db
      .prepare('SELECT * FROM device_report_grants WHERE token_hash=?')
      .get(digest(token)) as Grant | undefined;
    if (
      !grant ||
      grant.revoked ||
      grant.resource !== this.resource ||
      grant.expires_at <= this.now() ||
      grant.auth_version !== this.repository.account()?.authVersion
    )
      return undefined;
    const allowed = new Set<string>(JSON.parse(grant.project_ids));
    const entities = this.repository.list();
    const projects = new Set(
      entities.filter((e) => e.kind === 'project' && allowed.has(e.id)).map((e) => e.id),
    );
    return {
      entities: entities.flatMap<ReportEntity>((e) => {
        if (e.kind === 'project')
          return projects.has(e.id)
            ? [{ kind: e.kind, id: e.id, name: e.name, status: e.status, updatedAt: e.updatedAt }]
            : [];
        if (!projects.has(e.projectId) || e.kind === 'release') return [];
        return [
          {
            kind: e.kind,
            id: e.id,
            projectId: e.projectId,
            title: e.title,
            status: e.status,
            updatedAt: e.updatedAt,
          },
        ];
      }),
    };
  }
}

/** Mount only after the owner-consent flow is implemented and reviewed. */
export function createDeviceReportsRouter(service: DeviceReports) {
  const router = Router();
  router.all('/', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      res.set('Allow', 'GET');
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }
    const header = req.get('authorization') ?? '';
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
    const snapshot = match && service.read(match[1]);
    if (!snapshot) {
      res.set('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    res.json(snapshot);
  });
  return router;
}
