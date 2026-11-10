import { createHash, randomUUID } from 'node:crypto';
import {
  batchSchema,
  undoSchema,
  entityDataSchema,
  entityLabel,
  type Entity,
  type Operation,
  type AuditChange,
  type AuditEvent,
  type ChangeRequest,
  type Snapshot,
} from '../../shared/schema';
import { Repository } from '../infrastructure/database';
import { AppError } from '../domain/errors';
import { findDuplicates, validateRelationships } from '../domain/rules';

type Source = 'web' | 'mcp';
type Plan = { state: Map<string, Entity>; changes: AuditChange[]; touched: Set<string> };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class HubService {
  constructor(readonly repository: Repository) {}
  snapshot(): Snapshot {
    return {
      entities: this.repository.list(),
      requests: this.repository.requests(),
      history: this.repository.history(),
      actions: this.repository.actions(),
    };
  }
  request(id: string): ChangeRequest {
    const found = this.repository.request(id);
    if (!found) throw new AppError('NOT_FOUND', '找不到此变更请求', 404);
    return found.request;
  }
  submit(input: unknown, source: Source): ChangeRequest {
    const parsed = batchSchema.parse(input),
      fingerprint = hash({ mode: 'batch', ...parsed });
    return this.repository.transaction(() => {
      const existing = this.replay(parsed.requestId, fingerprint);
      if (existing) return existing;
      const operations: Operation[] = parsed.operations.map((op) =>
        op.action === 'create' ? { ...op, id: op.id ?? randomUUID() } : op,
      );
      const plan = this.plan(operations);
      const duplicates = findDuplicates(plan.state, plan.touched);
      const request: ChangeRequest = {
        id: parsed.requestId,
        mode: 'batch',
        status: 'pending',
        source,
        createdAt: new Date().toISOString(),
        operations,
        duplicates,
      };
      if (operations.every((op) => op.action === 'create') && duplicates.length === 0)
        this.apply(request, plan);
      this.repository.saveRequest(request, fingerprint);
      return request;
    });
  }
  requestUndo(input: unknown): ChangeRequest {
    const parsed = undoSchema.parse(input),
      fingerprint = hash({ mode: 'undo', ...parsed });
    return this.repository.transaction(() => {
      const existing = this.replay(parsed.requestId, fingerprint);
      if (existing) return existing;
      const plan = this.undoPlan(parsed.auditId);
      const request: ChangeRequest = {
        id: parsed.requestId,
        mode: 'undo',
        status: 'pending',
        source: 'web',
        createdAt: new Date().toISOString(),
        operations: [],
        auditId: parsed.auditId,
        duplicates: findDuplicates(plan.state, plan.touched),
      };
      this.repository.saveRequest(request, fingerprint);
      return request;
    });
  }
  confirm(id: string): ChangeRequest {
    return this.repository.transaction(() => {
      const found = this.repository.request(id);
      if (!found) throw new AppError('NOT_FOUND', '找不到此变更请求', 404);
      const request = found.request;
      if (request.status === 'applied') return request;
      if (request.status === 'rejected')
        throw new AppError('REQUEST_REJECTED', '此请求已被拒绝', 409);
      const plan =
        request.mode === 'undo' ? this.undoPlan(request.auditId!) : this.plan(request.operations);
      const allowed = new Set(request.duplicates.map((d) => d.proposedId + ':' + d.existingId));
      if (
        findDuplicates(plan.state, plan.touched).some(
          (d) => !allowed.has(d.proposedId + ':' + d.existingId),
        )
      )
        throw new AppError(
          'DUPLICATES_CHANGED',
          '又发现了新的相似项目，请拒绝当前请求并重新提交以查看最新结果',
          409,
        );
      this.apply(request, plan, true);
      if (request.mode === 'undo') {
        const original = this.repository.auditEvent(request.auditId!)!;
        original.undoneBy = request.result!.auditId;
        this.repository.saveAudit(original);
      }
      this.repository.saveRequest(request, found.hash);
      return request;
    });
  }
  reject(id: string): ChangeRequest {
    return this.repository.transaction(() => {
      const found = this.repository.request(id);
      if (!found) throw new AppError('NOT_FOUND', '找不到此变更请求', 404);
      if (found.request.status === 'applied')
        throw new AppError('ALREADY_APPLIED', '已应用的操作不能拒绝，请使用撤销', 409);
      found.request.status = 'rejected';
      this.repository.saveRequest(found.request, found.hash);
      return found.request;
    });
  }
  private replay(id: string, fingerprint: string): ChangeRequest | undefined {
    const existing = this.repository.request(id);
    if (!existing) return undefined;
    if (existing.hash !== fingerprint)
      throw new AppError(
        'IDEMPOTENCY_CONFLICT',
        '同一 requestId 不能用于不同内容，请保留原请求重试或使用新的 ID',
        409,
      );
    return existing.request;
  }
  private plan(operations: Operation[]): Plan {
    const state = new Map(this.repository.list().map((e) => [e.id, e])),
      changes: AuditChange[] = [],
      touched = new Set<string>(),
      now = new Date().toISOString();
    for (const operation of operations) {
      const id = operation.id!;
      if (touched.has(id))
        throw new AppError('DUPLICATE_OPERATION', '同一批次不能重复操作同一条记录');
      touched.add(id);
      const stored = this.repository.get(id);
      if (operation.action === 'create') {
        if (stored) throw new AppError('ID_EXISTS', '该 ID 已存在，包括历史删除记录', 409);
        const entity: Entity = {
          ...operation.entity,
          id,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        };
        state.set(id, entity);
        changes.push({ id, before: null, after: entity, afterRevision: 1 });
      } else {
        if (!stored || stored.deleted) throw new AppError('NOT_FOUND', '记录不存在或已删除', 404);
        const before = stored.entity;
        if (before.revision !== operation.expectedRevision)
          throw new AppError('REVISION_CONFLICT', '记录已经发生变化，请刷新后重新提交', 409);
        if (operation.action === 'delete') {
          state.delete(id);
          changes.push({ id, before, after: null, afterRevision: before.revision + 1 });
        } else {
          if (
            operation.entity.kind !== before.kind ||
            (operation.entity.kind !== 'project' &&
              before.kind !== 'project' &&
              operation.entity.projectId !== before.projectId)
          )
            throw new AppError('IMMUTABLE_FIELD', '不能修改记录类型或所属项目');
          const after: Entity = {
            ...operation.entity,
            id,
            revision: before.revision + 1,
            createdAt: before.createdAt,
            updatedAt: now,
          };
          state.set(id, after);
          changes.push({ id, before, after, afterRevision: after.revision });
        }
      }
    }
    validateRelationships(state);
    return { state, changes, touched };
  }
  private undoPlan(auditId: string): Plan {
    const event = this.repository.auditEvent(auditId);
    if (!event) throw new AppError('NOT_FOUND', '找不到此历史记录', 404);
    if (event.undoneBy) throw new AppError('ALREADY_UNDONE', '该操作已撤销', 409);
    const state = new Map(this.repository.list().map((e) => [e.id, e])),
      changes: AuditChange[] = [],
      touched = new Set<string>(),
      now = new Date().toISOString();
    for (const change of event.changes) {
      const stored = this.repository.get(change.id);
      if (
        !stored ||
        stored.entity.revision !== change.afterRevision ||
        stored.deleted !== (change.after === null)
      )
        throw new AppError(
          'UNDO_CONFLICT',
          '记录已有后续修改，不能直接覆盖；请根据历史手动调整',
          409,
        );
      touched.add(change.id);
      const revision = stored.entity.revision + 1,
        before = stored.deleted ? null : stored.entity;
      const after: Entity | null = change.before
        ? {
            ...entityDataSchema.parse(stripMetadata(change.before)),
            id: change.id,
            revision,
            createdAt: change.before.createdAt,
            updatedAt: now,
          }
        : null;
      if (after) state.set(change.id, after);
      else state.delete(change.id);
      changes.push({ id: change.id, before, after, afterRevision: revision });
    }
    validateRelationships(state);
    return { state, changes, touched };
  }
  private apply(request: ChangeRequest, plan: Plan, confirmed = false): void {
    const now = new Date().toISOString();
    // Insert projects first so batch order does not affect foreign-key validity.
    const ordered = [...plan.changes].sort(
      (a, b) => Number(b.after?.kind === 'project') - Number(a.after?.kind === 'project'),
    );
    for (const change of ordered) {
      if (change.after) this.repository.put(change.after);
      else {
        const old = change.before ?? this.repository.get(change.id)!.entity;
        this.repository.put({ ...old, revision: change.afterRevision, updatedAt: now }, true);
      }
    }
    const audit: AuditEvent = {
      id: randomUUID(),
      requestId: request.id,
      source: request.source,
      createdAt: now,
      summary:
        request.mode === 'undo'
          ? '撤销历史操作'
          : plan.changes
              .map(
                (c) =>
                  (c.after ? (c.before ? '修改' : '新增') : '删除') +
                  '「' +
                  entityLabel(c.after ?? c.before!) +
                  '」',
              )
              .join('、'),
      changes: plan.changes,
      undoneBy: null,
      actor: request.source === 'mcp' ? 'mcp-client' : 'local-user',
      confirmedBy: confirmed ? 'local-user' : null,
    };
    this.repository.saveAudit(audit);
    request.status = 'applied';
    request.result = {
      auditId: audit.id,
      entities: plan.changes.flatMap((c) => (c.after ? [c.after] : [])),
    };
  }
}
function stripMetadata(entity: Entity): unknown {
  const {
    id: _id,
    revision: _revision,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...data
  } = entity;
  return data;
}
