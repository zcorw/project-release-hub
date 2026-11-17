import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HubService } from '../server/application/hub';
import { Repository } from '../server/infrastructure/database';
import {
  batchSchema,
  entityData,
  projectSchema,
  type Entity,
  type Project,
} from '../shared/schema';

let repository: Repository, hub: HubService;
const batch = (operations: unknown[]) => ({ requestId: randomUUID(), operations });
const create = (fields: Record<string, unknown> = {}) =>
  hub.submit(
    batch([{ action: 'create', entity: { kind: 'project', name: 'Introduction', ...fields } }]),
    'mcp',
  ).result!.entities[0] as Project;
const update = (project: Entity, fields: Record<string, unknown>, source: 'mcp' | 'web' = 'mcp') =>
  hub.submit(
    batch([
      {
        action: 'update',
        id: project.id,
        expectedRevision: project.revision,
        entity: { ...entityData(project), ...fields },
      },
    ]),
    source,
  );

beforeEach(() => {
  repository = new Repository(':memory:');
  hub = new HubService(repository);
});
afterEach(() => repository.close());

describe('project introductions', () => {
  it('keeps legacy wire fields absent for request fingerprints and replays them unchanged', () => {
    const input = batch([{ action: 'create', entity: { kind: 'project', name: 'Legacy' } }]);
    const parsed = batchSchema.parse(input).operations[0];
    expect(parsed.action === 'create' && Object.hasOwn(parsed.entity, 'summary')).toBe(false);
    const applied = hub.submit(input, 'mcp');
    const stored = repository.request(input.requestId)!;
    expect(applied.result!.entities[0]).toMatchObject({ summary: '' });
    expect(hub.submit(input, 'mcp')).toEqual(applied);
    expect(repository.request(input.requestId)).toEqual(stored);
    expect(repository.list()).toHaveLength(1);
  });

  it('persists a trimmed introduction separately from a complete description and preserves old-client updates', () => {
    const description = 'Project purpose\n\nTask log: tested, committed and deployed.';
    const project = create({ summary: '  A focused project introduction.  ', description });
    expect(project).toMatchObject({ summary: 'A focused project introduction.', description });
    const { summary: _summary, ...legacy } = entityData(project) as ReturnType<
      typeof projectSchema.parse
    >;
    const applied = hub.submit(
      batch([
        {
          action: 'update',
          id: project.id,
          expectedRevision: project.revision,
          entity: { ...legacy, status: 'paused' },
        },
      ]),
      'mcp',
    );
    expect(repository.get(project.id)!.entity).toMatchObject({
      summary: project.summary,
      description,
      status: 'paused',
      revision: 2,
    });
    expect(repository.auditEvent(applied.result!.auditId)!.changes[0]).toMatchObject({
      before: { summary: project.summary, description },
      after: { summary: project.summary, description },
    });
  });

  it('clears only an explicitly empty introduction and restores it through confirmed undo', () => {
    const project = create({ summary: 'Purpose', description: 'Complete retained history' });
    const applied = update(project, { summary: '   ' });
    expect(repository.get(project.id)!.entity).toMatchObject({
      summary: '',
      description: project.description,
      revision: 2,
    });
    const undo = hub.requestUndo({ requestId: randomUUID(), auditId: applied.result!.auditId });
    expect(undo.status).toBe('pending');
    expect(repository.get(project.id)!.entity).toMatchObject({ summary: '' });
    hub.confirm(undo.id);
    expect(repository.get(project.id)!.entity).toMatchObject({
      summary: 'Purpose',
      description: project.description,
      revision: 3,
    });
  });

  it('validates the introduction and rolls back an entire invalid batch', () => {
    expect(
      projectSchema.parse({ kind: 'project', name: 'Boundary', summary: 'x'.repeat(500) }).summary,
    ).toHaveLength(500);
    for (const summary of ['x'.repeat(501), null, 123]) {
      expect(() =>
        hub.submit(
          batch([
            { action: 'create', entity: { kind: 'project', name: 'First' } },
            { action: 'create', entity: { kind: 'project', name: 'Invalid', summary } },
          ]),
          'mcp',
        ),
      ).toThrow();
    }
    expect(repository.list()).toEqual([]);
    expect(repository.history()).toEqual([]);
  });

  it('preserves the latest introduction when reconciling an old proposal that omitted it', () => {
    const project = create({ description: 'Original history' });
    const { summary: _summary, ...legacy } = entityData(project) as ReturnType<
      typeof projectSchema.parse
    >;
    const source = hub.submit(
      batch([
        {
          action: 'update',
          id: project.id,
          expectedRevision: project.revision,
          entity: { ...legacy, description: 'Proposed history' },
        },
      ]),
      'web',
    );
    update(project, { summary: 'New introduction' });
    const preview = hub.previewRebase(source.id);
    expect(preview.items[0]).toMatchObject({
      conflicts: [],
      merged: { summary: 'New introduction', description: 'Proposed history' },
    });
    const replacement = hub.rebase(source.id, {
      requestId: randomUUID(),
      previewToken: preview.token,
      resolutions: [],
    });
    expect(replacement.status).toBe('pending');
    expect(repository.get(project.id)!.entity).toMatchObject({ description: 'Original history' });
    hub.confirm(replacement.id);
    expect(repository.get(project.id)!.entity).toMatchObject({
      summary: 'New introduction',
      description: 'Proposed history',
    });
  });

  it('requires a field choice for competing introductions and retains separate confirmation', () => {
    const project = create({ summary: 'Original introduction' });
    const source = update(project, { summary: 'Proposed introduction' }, 'web');
    update(project, { summary: 'Current introduction' });
    const preview = hub.previewRebase(source.id);
    expect(preview.items[0].conflicts).toEqual(['summary']);
    const replacement = hub.rebase(source.id, {
      requestId: randomUUID(),
      previewToken: preview.token,
      resolutions: [{ id: project.id, field: 'summary', choice: 'proposed' }],
    });
    expect(repository.get(project.id)!.entity).toMatchObject({ summary: 'Current introduction' });
    hub.confirm(replacement.id);
    expect(repository.get(project.id)!.entity).toMatchObject({ summary: 'Proposed introduction' });
  });

  it('reads legacy disk records without rewriting description, metadata, audit or request bytes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zhixu-summary-'));
    const filename = join(directory, 'legacy.db');
    let db = new Repository(filename);
    try {
      const service = new HubService(db);
      const applied = service.submit(
        batch([
          {
            action: 'create',
            entity: { kind: 'project', name: 'Disk legacy', description: 'Full historical log' },
          },
        ]),
        'mcp',
      );
      const project = applied.result!.entities[0];
      db.db
        .prepare("UPDATE entities SET data=json_remove(data,'$.summary') WHERE id=?")
        .run(project.id);
      // Represent pre-field snapshots without modifying their request hash or metadata.
      const stripSummary = (value: unknown): unknown =>
        Array.isArray(value)
          ? value.map(stripSummary)
          : value && typeof value === 'object'
            ? Object.fromEntries(
                Object.entries(value)
                  .filter(([key]) => key !== 'summary')
                  .map(([key, field]) => [key, stripSummary(field)]),
              )
            : value;
      for (const table of ['requests', 'audit']) {
        const rows = db.db.prepare(`SELECT id,data FROM ${table}`).all() as {
          id: string;
          data: string;
        }[];
        for (const row of rows)
          db.db
            .prepare(`UPDATE ${table} SET data=? WHERE id=?`)
            .run(JSON.stringify(stripSummary(JSON.parse(row.data))), row.id);
      }
      const stored = () => ({
        entity: db.db.prepare('SELECT * FROM entities WHERE id=?').get(project.id),
        audit: db.db.prepare('SELECT * FROM audit').all(),
        requests: db.db.prepare('SELECT * FROM requests').all(),
      });
      const before = stored();
      db.close();
      for (let i = 0; i < 2; i++) {
        db = new Repository(filename);
        const legacy = db.get(project.id)!.entity;
        expect(legacy).toMatchObject({
          summary: '',
          description: 'Full historical log',
          revision: project.revision,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        });
        expect(entityData(legacy)).toMatchObject({ summary: '' });
        expect(stored()).toEqual(before);
        db.close();
      }
    } finally {
      if (db.db.open) db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
