import { z } from 'zod';

export const kinds = ['project', 'feature', 'task', 'issue', 'release'] as const;
export type Kind = (typeof kinds)[number];
export const priorities = ['P0', 'P1', 'P2', 'P3'] as const;
export const featureStatuses = ['backlog', 'planned', 'in_progress', 'blocked', 'done'] as const;
export const taskStatuses = ['todo', 'in_progress', 'blocked', 'done'] as const;
export const issueStatuses = ['open', 'in_progress', 'resolved', 'closed'] as const;
export const releaseStatuses = [
  'draft',
  'planned',
  'in_progress',
  'released',
  'failed',
  'rolled_back',
] as const;
export const projectStatuses = ['active', 'paused', 'archived'] as const;
export const environmentStatuses = [
  'not_set',
  'development',
  'healthy',
  'degraded',
  'offline',
] as const;
const title = z.string().trim().min(1, '请填写名称或标题').max(120, '最多 120 个字符');
const description = z.string().max(10000, '最多 10000 个字符').default('');
const link = z
  .union([
    z.literal(''),
    z
      .url()
      .refine((v) => ['http:', 'https:'].includes(new URL(v).protocol), '仅支持 HTTP/HTTPS 地址'),
  ])
  .default('');
const optionalId = z.union([z.literal(''), z.uuid()]).default('');
const date = z
  .string()
  .refine(
    (v) =>
      v === '' ||
      (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
        !Number.isNaN(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v),
    '请输入有效日期',
  )
  .default('');
export const projectSchema = z
  .object({
    kind: z.literal('project'),
    name: title,
    description,
    repository: z
      .string()
      .trim()
      .max(200)
      .regex(/^$|^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, '仓库格式为 owner/repo')
      .default(''),
    status: z.enum(projectStatuses).default('active'),
    environmentName: z.string().trim().min(1, '请填写环境名称').max(80).default('正式环境'),
    environmentUrl: link,
    environmentStatus: z.enum(environmentStatuses).default('not_set'),
    deployedVersion: z.string().trim().max(80).default(''),
  })
  .strict();
const common = {
  projectId: z.uuid(),
  title,
  description,
  priority: z.enum(priorities).default('P2'),
};
export const featureSchema = z
  .object({
    kind: z.literal('feature'),
    ...common,
    status: z.enum(featureStatuses).default('backlog'),
    acceptanceCriteria: description,
    plannedStart: date,
    plannedEnd: date,
    targetReleaseId: optionalId,
  })
  .strict()
  .refine((v) => !v.plannedStart || !v.plannedEnd || v.plannedStart <= v.plannedEnd, {
    path: ['plannedEnd'],
    message: '结束日期不能早于开始日期',
  });
export const taskSchema = z
  .object({
    kind: z.literal('task'),
    ...common,
    status: z.enum(taskStatuses).default('todo'),
    featureId: optionalId,
    targetReleaseId: optionalId,
    dueDate: date,
  })
  .strict();
export const issueSchema = z
  .object({
    kind: z.literal('issue'),
    ...common,
    status: z.enum(issueStatuses).default('open'),
    featureId: optionalId,
    targetReleaseId: optionalId,
  })
  .strict();
export const releaseSchema = z
  .object({
    kind: z.literal('release'),
    projectId: z.uuid(),
    version: title,
    status: z.enum(releaseStatuses).default('draft'),
    plannedDate: date,
    releasedDate: date,
    notes: description,
  })
  .strict()
  .refine((v) => v.status !== 'released' || !!v.releasedDate, {
    path: ['releasedDate'],
    message: '已发布版本需要填写实际发布日期',
  });
export const entityDataSchema = z.discriminatedUnion('kind', [
  projectSchema,
  featureSchema,
  taskSchema,
  issueSchema,
  releaseSchema,
]);
export type EntityData = z.infer<typeof entityDataSchema>;
export interface Metadata {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export type Entity = EntityData & Metadata;
export type Project = Extract<Entity, { kind: 'project' }>;
export const operationSchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('create'), id: z.uuid().optional(), entity: entityDataSchema })
    .strict(),
  z
    .object({
      action: z.literal('update'),
      id: z.uuid(),
      expectedRevision: z.number().int().positive(),
      entity: entityDataSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('delete'),
      id: z.uuid(),
      expectedRevision: z.number().int().positive(),
    })
    .strict(),
]);
export type Operation = z.infer<typeof operationSchema>;
export const batchSchema = z
  .object({ requestId: z.uuid(), operations: z.array(operationSchema).min(1).max(20) })
  .strict();
export type BatchInput = z.infer<typeof batchSchema>;
export const undoSchema = z.object({ requestId: z.uuid(), auditId: z.uuid() }).strict();
export const rebaseSchema = z
  .object({
    requestId: z.uuid(),
    previewToken: z.string().regex(/^[a-f0-9]{64}$/),
    resolutions: z
      .array(
        z
          .object({
            id: z.uuid(),
            field: z.string().min(1).max(80),
            choice: z.enum(['current', 'proposed']),
          })
          .strict(),
      )
      .max(400),
  })
  .strict();
export type RebaseInput = z.infer<typeof rebaseSchema>;
export interface RebaseItem {
  operation: Operation;
  base: Entity | null;
  current: Entity | null;
  merged: EntityData | null;
  conflicts: string[];
}
export interface RebasePreview {
  requestId: string;
  token: string;
  items: RebaseItem[];
  blockers: { id: string; message: string }[];
}
export const passwordSchema = z.string().min(12, '密码至少 12 位').max(128, '密码最多 128 位');
export const loginSchema = z.object({ password: z.string().min(1, '请输入密码').max(128) });
export const setupSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: '两次密码不一致',
  });
export interface DuplicateCandidate {
  proposedId: string;
  existingId: string;
  name: string;
  reason: string;
}
export interface AuditChange {
  id: string;
  before: Entity | null;
  after: Entity | null;
  afterRevision: number;
}
export interface AuditEvent {
  id: string;
  requestId: string;
  source: 'web' | 'mcp';
  createdAt: string;
  summary: string;
  changes: AuditChange[];
  undoneBy: string | null;
  actor: string;
  confirmedBy: string | null;
}
export interface ChangeRequest {
  id: string;
  mode: 'batch' | 'undo';
  status: 'pending' | 'applied' | 'rejected';
  source: 'web' | 'mcp';
  createdAt: string;
  operations: Operation[];
  auditId?: string;
  duplicates: DuplicateCandidate[];
  baseEntities?: Record<string, Entity>;
  rebasedFrom?: string;
  supersededBy?: string;
  result?: { auditId: string; entities: Entity[] };
}
export interface ActionRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  branch: string;
  event: string;
  createdAt: string;
  url: string;
}
export interface ActionsSnapshot {
  projectId: string;
  repository: string;
  runs: ActionRun[];
  updatedAt: string | null;
  attemptedAt: string;
  error: string | null;
}
export interface Snapshot {
  entities: Entity[];
  requests: ChangeRequest[];
  history: AuditEvent[];
  actions: ActionsSnapshot[];
}
export function entityLabel(entity: EntityData): string {
  return entity.kind === 'project'
    ? entity.name
    : entity.kind === 'release'
      ? entity.version
      : entity.title;
}
export function entityData(entity: Entity): EntityData {
  const {
    id: _id,
    revision: _revision,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...data
  } = entity;
  return entityDataSchema.parse(data);
}
