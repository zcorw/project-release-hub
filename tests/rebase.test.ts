import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HubService } from '../server/application/hub';
import { Repository } from '../server/infrastructure/database';
import {
  entityData,
  type ChangeRequest,
  type Entity,
  type RebaseInput,
  type RebasePreview,
} from '../shared/schema';

let repository: Repository, hub: HubService, project: Entity;
const batch = (operations: unknown[]) => ({ requestId: randomUUID(), operations });
const create = (name: string = randomUUID()) => ({
  action: 'create',
  entity: { kind: 'project', name },
});
function update(base: Entity, fields: Record<string, string>, extra: unknown[] = []) {
  return hub.submit(
    batch([
      {
        action: 'update',
        id: base.id,
        expectedRevision: base.revision,
        entity: { ...entityData(base), ...fields },
      },
      ...extra,
    ]),
    'web',
  );
}
function rebase(
  source: ChangeRequest,
  resolutions: RebaseInput['resolutions'] = [],
  preview?: RebasePreview,
) {
  return hub.rebase(source.id, {
    requestId: randomUUID(),
    previewToken: (preview ?? hub.previewRebase(source.id)).token,
    resolutions,
  });
}
beforeEach(() => {
  repository = new Repository(':memory:');
  hub = new HubService(repository);
  project = hub.submit(batch([create('Original')]), 'web').result!.entities[0];
});
afterEach(() => repository.close());

describe('proposal reconciliation', () => {
  it('preserves applied fields and stages a linked replacement without applying records', () => {
    const source = update(project, { description: 'Proposal description' });
    const concurrent = update(project, { environmentName: 'Already applied' });
    hub.confirm(concurrent.id);
    const latest = repository.get(project.id)!.entity;
    const preview = hub.previewRebase(source.id);
    expect(preview.items[0].base).toEqual(project);
    expect(preview.items[0].conflicts).toEqual([]);
    expect(repository.get(project.id)!.entity).toEqual(latest);
    const historyLength = hub.snapshot().history.length;
    const replacement = rebase(source, [], preview);
    expect(replacement).toMatchObject({ status: 'pending', source: 'web', rebasedFrom: source.id });
    expect(replacement.baseEntities?.[project.id]).toEqual(latest);
    expect(replacement.operations[0]).toMatchObject({
      expectedRevision: 2,
      entity: { description: 'Proposal description', environmentName: 'Already applied' },
    });
    expect(hub.request(source.id)).toMatchObject({
      status: 'rejected',
      supersededBy: replacement.id,
      operations: source.operations,
    });
    expect(() => hub.confirm(source.id)).toThrow('拒绝');
    expect(repository.get(project.id)!.entity).toEqual(latest);
    expect(hub.snapshot().history).toHaveLength(historyLength);
    const applied = hub.confirm(replacement.id);
    expect(applied.result!.entities[0]).toMatchObject({
      revision: 3,
      description: 'Proposal description',
      environmentName: 'Already applied',
    });
    expect(repository.auditEvent(applied.result!.auditId)).toMatchObject({
      actor: 'local-user',
      confirmedBy: 'local-user',
    });
  });

  it.each(['current', 'proposed'] as const)(
    'requires explicit field choices and uses %s',
    (choice) => {
      const source = update(project, {
        description: 'Wanted',
        environmentName: 'Both',
        name: 'Renamed',
      });
      hub.confirm(
        update(project, { description: 'Latest', environmentName: 'Both', status: 'paused' }).id,
      );
      const preview = hub.previewRebase(source.id);
      expect(preview.items[0].conflicts).toEqual(['description']);
      expect(preview.items[0].merged).toMatchObject({
        environmentName: 'Both',
        status: 'paused',
        name: 'Renamed',
      });
      expect(() => rebase(source)).toThrow('每一处冲突');
      expect(() => rebase(source, [{ id: project.id, field: 'status', choice }])).toThrow('不属于');
      const resolution = { id: project.id, field: 'description', choice };
      expect(() => rebase(source, [resolution, resolution])).toThrow('重复');
      expect(hub.request(source.id).status).toBe('pending');
      const replacement = rebase(source, [resolution]);
      expect(replacement.operations[0]).toMatchObject({
        entity: {
          description: choice === 'current' ? 'Latest' : 'Wanted',
          status: 'paused',
          name: 'Renamed',
        },
      });
      expect(repository.get(project.id)!.entity).toMatchObject({ description: 'Latest' });
    },
  );

  it('rejects changed previews and rechecks revisions at final confirmation', () => {
    const source = update(project, { description: 'Wanted' });
    const preview = hub.previewRebase(source.id);
    hub.confirm(update(project, { environmentName: 'New environment' }).id);
    expect(() => rebase(source, [], preview)).toThrow('预览后又有变化');
    expect(hub.request(source.id).status).toBe('pending');
    const replacement = rebase(source);
    const latest = repository.get(project.id)!.entity;
    hub.confirm(update(latest, { status: 'paused' }).id);
    expect(() => hub.confirm(replacement.id)).toThrow('刷新');
    const second = rebase(replacement);
    expect(hub.confirm(second.id).result!.entities[0]).toMatchObject({
      description: 'Wanted',
      status: 'paused',
      environmentName: 'New environment',
    });
  });

  it('replays the exact generation after supersession and application but rejects changed payloads', () => {
    const source = update(project, { description: 'Wanted' });
    const input = {
      requestId: randomUUID(),
      previewToken: hub.previewRebase(source.id).token,
      resolutions: [],
    };
    const generated = hub.rebase(source.id, input);
    expect(hub.rebase(source.id, input)).toEqual(generated);
    const applied = hub.confirm(generated.id);
    expect(hub.rebase(source.id, input)).toEqual(applied);
    expect(() => hub.rebase(source.id, { ...input, previewToken: '0'.repeat(64) })).toThrow(
      'requestId',
    );
    expect(() => hub.previewRebase(source.id)).toThrow('待确认');
    expect(() => hub.previewRebase(applied.id)).toThrow('待确认');
  });

  it('recovers legacy bases from audit events older than the visible history window', () => {
    const source = update(project, { description: 'Wanted' });
    const stored = repository.request(source.id)!;
    delete stored.request.baseEntities;
    repository.saveRequest(stored.request, stored.hash);
    hub.confirm(update(project, { environmentName: 'Applied' }).id);
    for (let i = 0; i < 105; i++) hub.submit(batch([create()]), 'web');
    expect(
      hub
        .snapshot()
        .history.some((event) => event.changes.some((change) => change.id === project.id)),
    ).toBe(false);
    expect(hub.previewRebase(source.id).items[0].base).toEqual(project);
    expect(rebase(source).operations[0]).toMatchObject({
      entity: { description: 'Wanted', environmentName: 'Applied' },
    });
  });

  it('blocks missing legacy bases instead of assuming every proposed field is new', () => {
    const source = update(project, { description: 'Wanted' });
    const stored = repository.request(source.id)!;
    delete stored.request.baseEntities;
    repository.saveRequest(stored.request, stored.hash);
    hub.confirm(update(project, { environmentName: 'Applied' }).id);
    repository.db.prepare('DELETE FROM audit').run();
    expect(hub.previewRebase(source.id).blockers[0].message).toContain('原始基准');
    expect(() => rebase(source)).toThrow('无法安全合并');
    expect(hub.request(source.id).status).toBe('pending');
  });

  it('does not resurrect deleted targets or reuse occupied create IDs', () => {
    const id = randomUUID();
    const source = update(project, { description: 'Wanted' }, [{ ...create(), id }]);
    hub.confirm(
      hub.submit(batch([{ action: 'delete', id: project.id, expectedRevision: 1 }]), 'web').id,
    );
    hub.submit(batch([{ ...create(), id }]), 'web');
    const preview = hub.previewRebase(source.id);
    expect(preview.blockers).toHaveLength(2);
    expect(preview.items[0].current).toBeNull();
    expect(() => rebase(source)).toThrow('无法安全合并');
    expect(hub.request(source.id).status).toBe('pending');
    expect(repository.get(project.id)!.deleted).toBe(true);
  });

  it('asks again before deleting an edited target and stages deletion against its latest revision', () => {
    const source = hub.submit(
      batch([{ action: 'delete', id: project.id, expectedRevision: 1 }]),
      'web',
    );
    hub.confirm(update(project, { description: 'Applied' }).id);
    expect(hub.previewRebase(source.id).items[0].conflicts).toEqual(['$delete']);
    expect(() => rebase(source)).toThrow('每一处冲突');
    expect(() => rebase(source, [{ id: project.id, field: '$delete', choice: 'current' }])).toThrow(
      '没有需要应用',
    );
    expect(hub.request(source.id).status).toBe('pending');
    const replacement = rebase(source, [{ id: project.id, field: '$delete', choice: 'proposed' }]);
    expect(replacement.operations).toEqual([
      { action: 'delete', id: project.id, expectedRevision: 2 },
    ]);
    expect(repository.get(project.id)!.deleted).toBe(false);
    hub.confirm(replacement.id);
    expect(repository.get(project.id)!.deleted).toBe(true);
  });

  it('keeps create-only remainders pending when a conflicting deletion is retained', () => {
    const source = hub.submit(
      batch([{ action: 'delete', id: project.id, expectedRevision: 1 }, create()]),
      'web',
    );
    hub.confirm(update(project, { description: 'Applied' }).id);
    const replacement = rebase(source, [{ id: project.id, field: '$delete', choice: 'current' }]);
    expect(replacement.status).toBe('pending');
    expect(replacement.operations).toHaveLength(1);
    expect(replacement.operations[0].action).toBe('create');
    expect(hub.snapshot().entities).toHaveLength(1);
    hub.confirm(replacement.id);
    expect(hub.snapshot().entities).toHaveLength(2);
  });

  it('omits changes already applied and does not create an empty replacement', () => {
    const source = update(project, { description: 'Same' });
    hub.confirm(update(project, { description: 'Same', status: 'paused' }).id);
    expect(hub.previewRebase(source.id).items[0].conflicts).toEqual([]);
    expect(() => rebase(source)).toThrow('没有需要应用');
    expect(hub.request(source.id).status).toBe('pending');
    expect(repository.get(project.id)!.entity.revision).toBe(2);
  });

  it('validates merged date ranges atomically instead of saving an invalid combination', () => {
    const feature = hub.submit(
      batch([
        {
          action: 'create',
          entity: {
            kind: 'feature',
            projectId: project.id,
            title: 'Dates',
            plannedStart: '2026-11-10',
            plannedEnd: '2026-11-20',
          },
        },
      ]),
      'web',
    ).result!.entities[0];
    const source = update(feature, { plannedStart: '2026-11-15' }, [create()]);
    hub.confirm(update(feature, { plannedEnd: '2026-11-12' }).id);
    const count = hub.snapshot().requests.length;
    expect(() => rebase(source)).toThrow('结束日期');
    expect(hub.request(source.id).status).toBe('pending');
    expect(hub.snapshot().requests).toHaveLength(count);
    expect(hub.snapshot().entities).toHaveLength(2);
  });

  it('revalidates references and detects duplicates when generating and confirming replacements', () => {
    const feature = hub.submit(
      batch([
        {
          action: 'create',
          entity: { kind: 'feature', projectId: project.id, title: 'Reference' },
        },
      ]),
      'web',
    ).result!.entities[0];
    const task = hub.submit(
      batch([{ action: 'create', entity: { kind: 'task', projectId: project.id, title: 'Task' } }]),
      'web',
    ).result!.entities[0];
    const source = update(task, { featureId: feature.id });
    const preview = hub.previewRebase(source.id);
    hub.confirm(
      hub.submit(batch([{ action: 'delete', id: feature.id, expectedRevision: 1 }]), 'web').id,
    );
    expect(() => rebase(source, [], preview)).toThrow('关联');
    expect(hub.request(source.id).status).toBe('pending');
    const rename = update(project, { name: 'Duplicate' });
    hub.submit(batch([create('Duplicate')]), 'web');
    const replacement = rebase(rename);
    expect(replacement.duplicates).toHaveLength(1);
    const other = hub.submit(batch([create('Other')]), 'web').result!.entities[0];
    hub.confirm(update(other, { name: 'Duplicate' }).id);
    expect(() => hub.confirm(replacement.id)).toThrow('新的相似项目');
  });

  it('rolls back replacement creation if supersession fails', () => {
    const source = update(project, { description: 'Wanted' });
    const input = {
      requestId: randomUUID(),
      previewToken: hub.previewRebase(source.id).token,
      resolutions: [],
    };
    repository.db.exec(`CREATE TRIGGER fail_supersession BEFORE UPDATE ON requests
      BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END`);
    expect(() => hub.rebase(source.id, input)).toThrow('simulated');
    expect(repository.request(input.requestId)).toBeUndefined();
    expect(hub.request(source.id).status).toBe('pending');
    expect(repository.get(project.id)!.entity).toEqual(project);
  });

  it('does not reconcile undo requests or rejected requests', () => {
    const event = hub.snapshot().history[0];
    const undo = hub.requestUndo({ requestId: randomUUID(), auditId: event.id });
    expect(() => hub.previewRebase(undo.id)).toThrow('普通变更');
    const source = update(project, { description: 'Wanted' });
    hub.reject(source.id);
    expect(() => hub.previewRebase(source.id)).toThrow('待确认');
  });
});
