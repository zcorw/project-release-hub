import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import type { Repository } from '../infrastructure/database';
import { DeviceReports, createDeviceReportsRouter } from './reports';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const credential = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const consent = z
  .object({ requestId: z.uuid(), projectIds: z.array(z.uuid()).min(1).max(100) })
  .strict();
type Pairing = {
  id: string;
  device_id: string;
  resource: string;
  auth_version: number;
  expires_at: number;
  project_ids: string | null;
  claimed: number;
  replay_nonce: string | null;
};
type Binding = {
  device_id: string;
  resource: string;
  auth_version: number;
  expires_at: number;
  project_ids: string;
  revoked: number;
  confirmed: number;
};

/** Isolated lifecycle. Owner methods must only be reached through a trusted CSRF-protected guard. */
export class DevicePairing {
  readonly reports: DeviceReports;
  constructor(
    private repository: Repository,
    issuer: string,
    private now = Date.now,
  ) {
    this.reports = new DeviceReports(repository, issuer, now);
    repository.db.exec(`CREATE TABLE IF NOT EXISTS device_pairings (
      id TEXT PRIMARY KEY, device_id TEXT NOT NULL, secret_hash TEXT UNIQUE NOT NULL,
      resource TEXT NOT NULL, auth_version INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      project_ids TEXT, replay_nonce TEXT, claimed INTEGER NOT NULL DEFAULT 0
    ); CREATE TABLE IF NOT EXISTS device_bindings (
      device_id TEXT PRIMARY KEY, refresh_hash TEXT UNIQUE NOT NULL, resource TEXT NOT NULL,
      auth_version INTEGER NOT NULL, expires_at INTEGER NOT NULL, project_ids TEXT NOT NULL,
      confirmed INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0
    )`);
  }
  begin() {
    const account = this.repository.account();
    if (!account) throw new Error('Account required');
    const id = randomUUID(),
      deviceId = randomUUID(),
      deviceSecret = secret();
    const expiresAt = this.now() + 5 * 60_000;
    this.repository.db
      .prepare(
        'INSERT INTO device_pairings(id,device_id,secret_hash,resource,auth_version,expires_at,replay_nonce) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        id,
        deviceId,
        hash(deviceSecret),
        this.reports.resource,
        account.authVersion,
        expiresAt,
        secret(),
      );
    return { requestId: id, deviceId, deviceSecret, expiresAt };
  }
  private current(row: { resource: string; auth_version: number; expires_at: number } | undefined) {
    return (
      row &&
      row.resource === this.reports.resource &&
      row.auth_version === this.repository.account()?.authVersion &&
      row.expires_at > this.now()
    );
  }
  approve(input: unknown) {
    const { requestId, projectIds } = consent.parse(input);
    return this.repository.transaction(() => {
      const row = this.repository.db
        .prepare('SELECT * FROM device_pairings WHERE id=?')
        .get(requestId) as Pairing | undefined;
      if (!this.current(row) || row!.claimed || row!.project_ids)
        throw new Error('Invalid pairing');
      for (const id of projectIds) {
        const project = this.repository.get(id);
        if (!project || project.deleted || project.entity.kind !== 'project')
          throw new Error('Unknown project');
      }
      this.repository.db
        .prepare('UPDATE device_pairings SET project_ids=? WHERE id=?')
        .run(JSON.stringify([...new Set(projectIds)]), requestId);
      this.repository.securityEvent('device_pairing_approved', row!.device_id);
      return { deviceId: row!.device_id };
    });
  }
  claim(value: unknown) {
    const token = credential.parse(value);
    return this.repository.transaction(() => {
      const row = this.repository.db
        .prepare('SELECT * FROM device_pairings WHERE secret_hash=?')
        .get(hash(token)) as Pairing | undefined;
      if (!this.current(row) || !row!.project_ids) throw new Error('Invalid pairing');
      const existing = this.repository.db
        .prepare('SELECT * FROM device_bindings WHERE device_id=?')
        .get(row!.device_id) as Binding | undefined;
      if ((row!.claimed && !existing) || existing?.confirmed || existing?.revoked)
        throw new Error('Invalid pairing');
      if (!row!.replay_nonce) throw new Error('Invalid pairing');
      // Server-only replay material is removed once the device confirms durable receipt.
      const refreshToken = createHmac('sha256', row!.replay_nonce)
        .update(token)
        .digest('base64url');
      const confirmationExpiresAt = existing?.expires_at ?? this.now() + 5 * 60_000;
      this.repository.db
        .prepare(
          'INSERT OR IGNORE INTO device_bindings(device_id,refresh_hash,resource,auth_version,expires_at,project_ids) VALUES(?,?,?,?,?,?)',
        )
        .run(
          row!.device_id,
          hash(refreshToken),
          row!.resource,
          row!.auth_version,
          confirmationExpiresAt,
          row!.project_ids,
        );
      this.repository.db
        .prepare('UPDATE device_pairings SET claimed=1, expires_at=? WHERE id=?')
        .run(confirmationExpiresAt, row!.id);
      return {
        deviceId: row!.device_id,
        refreshToken,
        confirmationExpiresAt,
        pending: true,
      };
    });
  }
  confirm(value: unknown) {
    const token = credential.parse(value);
    return this.repository.transaction(() => {
      const row = this.repository.db
        .prepare('SELECT * FROM device_bindings WHERE refresh_hash=?')
        .get(hash(token)) as Binding | undefined;
      if (!this.current(row) || row!.revoked) throw new Error('Invalid binding');
      const refreshExpiresAt = row!.confirmed
        ? row!.expires_at
        : this.now() + 30 * 24 * 60 * 60_000;
      const access = this.reports.createApprovedGrant({
        deviceId: row!.device_id,
        projectIds: JSON.parse(row!.project_ids),
      });
      if (!row!.confirmed) {
        this.repository.db
          .prepare('UPDATE device_bindings SET confirmed=1, expires_at=? WHERE device_id=?')
          .run(refreshExpiresAt, row!.device_id);
        this.repository.db
          .prepare('UPDATE device_pairings SET replay_nonce=NULL WHERE device_id=?')
          .run(row!.device_id);
        this.repository.securityEvent('device_bound', row!.device_id);
      }
      return { ...access, refreshExpiresAt };
    });
  }

  renew(value: unknown) {
    const token = credential.parse(value);
    return this.repository.transaction(() => {
      const row = this.repository.db
        .prepare('SELECT * FROM device_bindings WHERE refresh_hash=?')
        .get(hash(token)) as Binding | undefined;
      if (!this.current(row) || row!.revoked || !row!.confirmed) throw new Error('Invalid binding');
      return this.reports.createApprovedGrant({
        deviceId: row!.device_id,
        projectIds: JSON.parse(row!.project_ids),
      });
    });
  }
  unbind(value: unknown) {
    const deviceId = z.uuid().parse(value);
    this.repository.transaction(() => {
      this.repository.db
        .prepare('UPDATE device_bindings SET revoked=1 WHERE device_id=?')
        .run(deviceId);
      this.repository.db
        .prepare('UPDATE device_pairings SET claimed=1, replay_nonce=NULL WHERE device_id=?')
        .run(deviceId);
      this.reports.revokeDevice(deviceId);
      this.repository.securityEvent('device_unbound', deviceId);
    });
  }
}

/** Never mounted by production. The caller must provide owner session AND CSRF verification. */
export function createDevicePairingRouter(service: DevicePairing, ownerWriteGuard: RequestHandler) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use('/reports', createDeviceReportsRouter(service.reports));
  router.use(
    rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  router.post('/pair', (_req, res) => res.json(service.begin()));
  router.post('/approve', ownerWriteGuard, (req, res) => res.json(service.approve(req.body)));
  router.post('/claim', (req, res) => res.json(service.claim(req.body?.deviceSecret)));
  router.post('/confirm', (req, res) => res.json(service.confirm(req.body?.refreshToken)));
  router.post('/renew', (req, res) => res.json(service.renew(req.body?.refreshToken)));
  router.post('/unbind', ownerWriteGuard, (req, res) => {
    service.unbind(req.body?.deviceId);
    res.json({ unbound: true });
  });
  router.use((_error: unknown, _req: unknown, res: import('express').Response, _next: unknown) => {
    res.status(400).json({ error: 'invalid_device_request' });
  });
  return router;
}
