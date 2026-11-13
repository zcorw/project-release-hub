import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Repository } from '../server/infrastructure/database';
import { HubService } from '../server/application/hub';
import { entityData, type Entity, type Operation } from '../shared/schema';
let repository: Repository, hub: HubService;
const batch = (operations: unknown[]) => ({ requestId: randomUUID(), operations });
const create = (name = 'Example', repository = '') => ({
  action: 'create',
  entity: { kind: 'project', name, repository },
});
const project = () => hub.submit(batch([create()]), 'web').result!.entities[0];
beforeEach(() => {
  repository = new Repository(':memory:');
  hub = new HubService(repository);
});
afterEach(() => repository.close());
describe('shared mutation safety', () => {
  it('saves additions atomically and replays a stable request', () => {
    const input = batch([create()]);
    const first = hub.submit(input, 'mcp');
    expect(first.status).toBe('applied');
    expect(hub.submit(input, 'mcp')).toEqual(first);
    expect(hub.snapshot().entities).toHaveLength(1);
    expect(() => hub.submit({ ...input, operations: [create('Different')] }, 'mcp')).toThrow(
      'requestId',
    );
  });
  it('rejects an invalid batch without writing earlier records', () => {
    expect(() =>
      hub.submit(
        batch([
          create(),
          { action: 'create', entity: { kind: 'task', projectId: randomUUID(), title: 'Orphan' } },
        ]),
        'mcp',
      ),
    ).toThrow();
    expect(hub.snapshot().entities).toHaveLength(0);
    expect(hub.snapshot().history).toHaveLength(0);
  });
  it('stages same-name or same-repository projects and requires explicit confirmation', () => {
    project();
    const request = hub.submit(batch([create('Example')]), 'mcp');
    expect(request.status).toBe('pending');
    expect(request.duplicates).toHaveLength(1);
    expect(hub.snapshot().entities).toHaveLength(1);
    hub.confirm(request.id);
    expect(hub.snapshot().entities).toHaveLength(2);
    expect(hub.confirm(request.id).status).toBe('applied');
  });
  it('keeps manual web deletion pending and supports rejection', () => {
    const p = project();
    const request = hub.submit(
      batch([{ action: 'delete', id: p.id, expectedRevision: p.revision }]),
      'web',
    );
    expect(hub.snapshot().entities).toHaveLength(1);
    hub.reject(request.id);
    expect(() => hub.confirm(request.id)).toThrow('拒绝');
    expect(hub.snapshot().entities).toHaveLength(1);
  });
  it('rechecks revisions at confirmation time', () => {
    const p = project();
    const operation = {
      action: 'update',
      id: p.id,
      expectedRevision: p.revision,
      entity: { ...entityData(p), description: 'first' },
    };
    const first = hub.submit(batch([operation]), 'web'),
      second = hub.submit(
        batch([{ ...operation, entity: { ...operation.entity, description: 'second' } }]),
        'web',
      );
    hub.confirm(first.id);
    expect(() => hub.confirm(second.id)).toThrow('刷新');
  });
  it('supports out-of-order project/child creation in one transaction', () => {
    const id = randomUUID();
    hub.submit(
      batch([
        { action: 'create', entity: { kind: 'feature', projectId: id, title: 'Feature' } },
        { ...create(), id },
      ]),
      'mcp',
    );
    expect(hub.snapshot().entities).toHaveLength(2);
  });
  it('blocks dangling references and references to a different project', () => {
    const p = project();
    hub.submit(
      batch([{ action: 'create', entity: { kind: 'feature', projectId: p.id, title: 'Feature' } }]),
      'web',
    );
    expect(() =>
      hub.submit(batch([{ action: 'delete', id: p.id, expectedRevision: p.revision }]), 'web'),
    ).toThrow('引用');
  });
  it('rejects duplicate releases and invalid date plans', () => {
    const p = project();
    expect(() =>
      hub.submit(
        batch([
          { action: 'create', entity: { kind: 'release', projectId: p.id, version: '1.0' } },
          { action: 'create', entity: { kind: 'release', projectId: p.id, version: '1.0' } },
        ]),
        'mcp',
      ),
    ).toThrow('版本号');
    expect(() =>
      hub.submit(
        batch([
          {
            action: 'create',
            entity: {
              kind: 'feature',
              projectId: p.id,
              title: 'Plan',
              plannedStart: '2026-12-31',
              plannedEnd: '2026-01-01',
            },
          },
        ]),
        'web',
      ),
    ).toThrow();
  });
  it('undoes additions only after confirmation and preserves audit history', () => {
    const request = hub.submit(batch([create()]), 'mcp');
    const undo = hub.requestUndo({ requestId: randomUUID(), auditId: request.result!.auditId });
    expect(hub.snapshot().entities).toHaveLength(1);
    hub.confirm(undo.id);
    expect(hub.snapshot().entities).toHaveLength(0);
    expect(hub.snapshot().history).toHaveLength(2);
    expect(() =>
      hub.requestUndo({ requestId: randomUUID(), auditId: request.result!.auditId }),
    ).toThrow('已撤销');
  });
  it('restores deleted data with a newer revision and blocks stale undo', () => {
    const p = project();
    const deletion = hub.submit(
      batch([{ action: 'delete', id: p.id, expectedRevision: p.revision }]),
      'web',
    );
    hub.confirm(deletion.id);
    const undo = hub.requestUndo({
      requestId: randomUUID(),
      auditId: hub.request(deletion.id).result!.auditId,
    });
    hub.confirm(undo.id);
    expect(hub.snapshot().entities[0].revision).toBe(3);
    expect(() =>
      hub.requestUndo({ requestId: randomUUID(), auditId: hub.snapshot().history.at(-1)!.id }),
    ).toThrow('后续修改');
  });
  it('prevents an undo that would break references added later', () => {
    const first = hub.submit(batch([create()]), 'web'),
      p = first.result!.entities[0];
    hub.submit(
      batch([{ action: 'create', entity: { kind: 'task', projectId: p.id, title: 'Later task' } }]),
      'web',
    );
    expect(() =>
      hub.requestUndo({ requestId: randomUUID(), auditId: first.result!.auditId }),
    ).toThrow('引用');
  });
  it('rejects repeated operations on the same record', () => {
    const p = project();
    const op: Operation = { action: 'delete', id: p.id, expectedRevision: p.revision };
    expect(() => hub.submit(batch([op, op]), 'web')).toThrow('重复操作');
  });
  it('requires renewed review if a new duplicate appears before confirmation', () => {
    const p = project();
    const request = hub.submit(
      batch([
        {
          action: 'update',
          id: p.id,
          expectedRevision: p.revision,
          entity: { ...entityData(p), name: 'Other project' },
        },
      ]),
      'web',
    );
    hub.submit(batch([create('Other project')]), 'web');
    expect(() => hub.confirm(request.id)).toThrow('新的相似项目');
  });
});

it('keeps older pending requests visible after more than 100 later requests', () => {
  const p = project();
  const old = hub.submit(
    batch([
      {
        action: 'update',
        id: p.id,
        expectedRevision: 1,
        entity: { ...entityData(p), description: 'Pending' },
      },
    ]),
    'web',
  );
  for (let i = 0; i < 105; i++) hub.submit(batch([create(randomUUID())]), 'web');
  expect(
    hub
      .snapshot()
      .requests.some((request) => request.id === old.id && request.status === 'pending'),
  ).toBe(true);
});
it('records the initiating actor and human confirmation separately', () => {
  const created = hub.submit(batch([create()]), 'mcp');
  const p = created.result!.entities[0];
  expect(repository.auditEvent(created.result!.auditId)?.actor).toBe('mcp-client');
  expect(repository.auditEvent(created.result!.auditId)?.confirmedBy).toBeNull();
  const edit = hub.submit(
    batch([
      {
        action: 'update',
        id: p.id,
        expectedRevision: 1,
        entity: { ...entityData(p), description: 'Approved' },
      },
    ]),
    'mcp',
  );
  expect(edit.status).toBe('applied');
  expect(repository.auditEvent(edit.result!.auditId)?.confirmedBy).toBeNull();
  const manual = hub.submit(batch([{ action: 'delete', id: p.id, expectedRevision: 2 }]), 'web');
  const applied = hub.confirm(manual.id);
  expect(repository.auditEvent(applied.result!.auditId)?.confirmedBy).toBe('local-user');
});

it('does not block MCP edits to existing similar projects but reviews new duplicate projects atomically', () => {
  const first = project();
  const duplicate = hub.submit(batch([create()]), 'web');
  const second = hub.confirm(duplicate.id).result!.entities[0];
  const edit = {
    action: 'update',
    id: first.id,
    expectedRevision: 1,
    entity: { ...entityData(first), description: 'Automatic' },
  };
  const applied = hub.submit(batch([edit]), 'mcp');
  expect(applied.status).toBe('applied');
  expect(applied.duplicates.length).toBeGreaterThan(0);
  const before = hub.snapshot().entities;
  const pending = hub.submit(
    batch([
      create(),
      { action: 'delete', id: second.id, expectedRevision: 1 },
      { ...edit, expectedRevision: 2 },
    ]),
    'mcp',
  );
  expect(pending.status).toBe('pending');
  expect(hub.snapshot().entities).toEqual(before);
});

it('replays historical pending MCP requests without applying them and keeps reconciliation available', () => {
  const p = project();
  const input = batch([
    {
      action: 'update',
      id: p.id,
      expectedRevision: 1,
      entity: { ...entityData(p), description: 'Legacy proposal' },
    },
  ]);
  const pending = hub.submit(input, 'web');
  // Model the pre-policy persisted shape without submitting through the new MCP path.
  const stored = repository.request(pending.id)!;
  stored.request.source = 'mcp';
  repository.saveRequest(stored.request, stored.hash);
  expect(hub.submit(input, 'mcp')).toMatchObject({ status: 'pending', source: 'mcp' });
  expect(repository.get(p.id)?.entity).toEqual(p);
  const preview = hub.previewRebase(pending.id);
  const replacement = hub.rebase(pending.id, {
    requestId: randomUUID(),
    previewToken: preview.token,
    resolutions: [],
  });
  expect(replacement).toMatchObject({ status: 'pending', source: 'web' });
  expect(repository.get(p.id)?.entity).toEqual(p);
});

it('rolls back direct MCP entities, audit and request when persistence fails', () => {
  const p = project();
  const before = hub.snapshot();
  repository.db.exec(`CREATE TRIGGER fail_request BEFORE INSERT ON requests
    BEGIN SELECT RAISE(ABORT, 'simulated persistence failure'); END`);
  expect(() =>
    hub.submit(
      batch([
        {
          action: 'update',
          id: p.id,
          expectedRevision: 1,
          entity: { ...entityData(p), description: 'Must roll back' },
        },
        { action: 'create', entity: { kind: 'task', projectId: p.id, title: 'Also rolled back' } },
      ]),
      'mcp',
    ),
  ).toThrow('simulated persistence failure');
  expect(hub.snapshot()).toEqual(before);
});
