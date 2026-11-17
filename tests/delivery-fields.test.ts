import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Repository } from '../server/infrastructure/database';
import { HubService } from '../server/application/hub';
import { entityData, taskSchema, issueSchema, batchSchema } from '../shared/schema';
import { mergeFields } from '../server/domain/rebase';
let repository: Repository, hub: HubService;
const batch = (operations: unknown[]) => ({ requestId: randomUUID(), operations });
beforeEach(() => {
  repository = new Repository(':memory:');
  hub = new HubService(repository);
});
afterEach(() => repository.close());
const createProject = () =>
  hub.submit(batch([{ action: 'create', entity: { kind: 'project', name: 'Delivery' } }]), 'mcp')
    .result!.entities[0];
describe('independent work-item delivery fields', () => {
  for (const kind of ['task', 'issue'] as const) {
    it(`${kind}: preserves workflow status and defaults omitted facts to unknown`, () => {
      const p = createProject();
      const input = batch([
        {
          action: 'create',
          entity: {
            kind,
            projectId: p.id,
            title: 'Legacy',
            status: kind === 'task' ? 'done' : 'resolved',
          },
        },
      ]);
      const result = hub.submit(input, 'mcp');
      expect(result.result!.entities[0]).toMatchObject({
        developmentStatus: 'unknown',
        githubStatus: 'unknown',
      });
      expect(hub.submit(input, 'mcp')).toEqual(result);
    });
    it(`${kind}: persists explicit values, preserves omitted update fields, and supports undo`, () => {
      const p = createProject();
      const item = hub.submit(
        batch([
          {
            action: 'create',
            entity: {
              kind,
              projectId: p.id,
              title: 'Explicit',
              developmentStatus: 'unverified',
              githubStatus: 'submitted',
            },
          },
        ]),
        'mcp',
      ).result!.entities[0];
      const {
        developmentStatus: _d,
        githubStatus: _g,
        ...oldClient
      } = entityData(item) as ReturnType<typeof taskSchema.parse>;
      const change = hub.submit(
        batch([
          {
            action: 'update',
            id: item.id,
            expectedRevision: 1,
            entity: { ...oldClient, title: 'Edited' },
          },
        ]),
        'mcp',
      );
      expect(repository.get(item.id)!.entity).toMatchObject({
        developmentStatus: 'unverified',
        githubStatus: 'submitted',
        revision: 2,
      });
      const current = repository.get(item.id)!.entity;
      const verified = hub.submit(
        batch([
          {
            action: 'update',
            id: item.id,
            expectedRevision: 2,
            entity: { ...entityData(current), developmentStatus: 'verified' },
          },
        ]),
        'mcp',
      );
      expect(repository.get(item.id)!.entity).toMatchObject({ developmentStatus: 'verified' });
      const undo = hub.requestUndo({ requestId: randomUUID(), auditId: verified.result!.auditId });
      hub.confirm(undo.id);
      expect(repository.get(item.id)!.entity).toMatchObject({
        developmentStatus: 'unverified',
        githubStatus: 'submitted',
      });
      expect(repository.auditEvent(change.result!.auditId)!.changes[0].before).toMatchObject({
        developmentStatus: 'unverified',
      });
    });
    it(`${kind}: rejects invalid values atomically`, () => {
      const p = createProject();
      expect(() =>
        hub.submit(
          batch([
            {
              action: 'create',
              entity: { kind, projectId: p.id, title: 'Invalid', githubStatus: 'local_commit' },
            },
          ]),
          'mcp',
        ),
      ).toThrow();
      expect(repository.list()).toHaveLength(1);
      expect(
        (kind === 'task' ? taskSchema : issueSchema).safeParse({
          kind,
          projectId: p.id,
          title: 'Invalid',
          developmentStatus: 'done',
        }).success,
      ).toBe(false);
    });
  }
  it('does not inject new fields into legacy wire payloads used for replay hashes', () => {
    const input = batch([
      { action: 'create', entity: { kind: 'task', projectId: randomUUID(), title: 'Old' } },
    ]);
    const op = batchSchema.parse(input).operations[0];
    expect(op.action === 'create' && Object.hasOwn(op.entity, 'developmentStatus')).toBe(false);
  });
  it('rebase keeps newly set delivery fields when old proposals omit them', () => {
    const p = createProject();
    const item = hub.submit(
      batch([{ action: 'create', entity: { kind: 'task', projectId: p.id, title: 'Base' } }]),
      'mcp',
    ).result!.entities[0];
    const base = { ...item };
    const current = { ...item, developmentStatus: 'verified' as const };
    const proposed = { ...entityData(item), title: 'New title' };
    delete (proposed as ReturnType<typeof taskSchema.parse>).developmentStatus;
    expect(mergeFields(base, current, proposed)).toMatchObject({
      merged: { developmentStatus: 'verified', title: 'New title' },
      conflicts: [],
    });
  });
  it('migrates v2 records including deleted ones without guessing or rewriting history/revisions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zhixu-delivery-'));
    const file = join(dir, 'test.db');
    let db = new Repository(file);
    try {
      const h = new HubService(db);
      const p = h.submit(
        batch([{ action: 'create', entity: { kind: 'project', name: 'Migration' } }]),
        'mcp',
      ).result!.entities[0];
      const item = h.submit(
        batch([
          {
            action: 'create',
            entity: { kind: 'task', projectId: p.id, title: 'Legacy', status: 'done' },
          },
        ]),
        'mcp',
      ).result!.entities[0];
      db.db
        .prepare(
          "UPDATE entities SET data=json_remove(data,'$.developmentStatus','$.githubStatus'),deleted=1 WHERE id=?",
        )
        .run(item.id);
      const history = db.history();
      const requests = db.requests();
      db.db.pragma('user_version=2');
      db.close();
      db = new Repository(file);
      expect(db.get(item.id)).toMatchObject({
        deleted: true,
        entity: {
          revision: 1,
          status: 'done',
          developmentStatus: 'unknown',
          githubStatus: 'unknown',
        },
      });
      expect(db.history()).toEqual(history);
      expect(db.requests()).toEqual(requests);
      expect(db.db.pragma('user_version', { simple: true })).toBe(3);
      db.close();
      db = new Repository(file);
      expect(db.get(item.id)!.entity).toMatchObject({ revision: 1, developmentStatus: 'unknown' });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
