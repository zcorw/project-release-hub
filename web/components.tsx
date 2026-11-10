import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useForm, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  entityDataSchema,
  entityData,
  entityLabel,
  projectStatuses,
  environmentStatuses,
  featureStatuses,
  taskStatuses,
  issueStatuses,
  releaseStatuses,
  priorities,
  type Kind,
  type Entity,
  type EntityData,
} from '../shared/schema';
import { errorText } from './api';

export const kindNames: Record<Kind, string> = {
  project: '项目',
  feature: '功能计划',
  task: '任务',
  issue: '问题',
  release: '版本',
};
export const labels: Record<string, string> = {
  project: '项目',
  feature: '功能计划',
  task: '任务',
  issue: '问题',
  release: '版本',
  kind: '类型',
  id: '记录编号',
  revision: '修订号',
  createdAt: '创建时间',
  updatedAt: '更新时间',
  projectId: '所属项目',
  name: '项目名称',
  title: '标题',
  description: '说明',
  repository: 'GitHub 仓库',
  status: '状态',
  environmentName: '环境名称',
  environmentUrl: '环境地址',
  environmentStatus: '环境状态',
  deployedVersion: '已部署版本',
  priority: '优先级',
  acceptanceCriteria: '验收标准',
  plannedStart: '计划开始日期',
  plannedEnd: '计划完成日期',
  targetReleaseId: '目标版本',
  featureId: '关联功能',
  dueDate: '截止日期',
  version: '版本号',
  plannedDate: '计划发布日期',
  releasedDate: '实际发布日期',
  notes: '发布说明',
  active: '进行中',
  paused: '已暂停',
  archived: '已归档',
  not_set: '未配置',
  development: '开发中',
  healthy: '运行正常',
  degraded: '运行异常',
  offline: '离线',
  backlog: '待规划',
  planned: '已计划',
  in_progress: '进行中',
  blocked: '受阻',
  done: '已完成',
  todo: '待处理',
  open: '待处理',
  resolved: '已解决',
  closed: '已关闭',
  draft: '草稿',
  released: '已发布',
  failed: '失败',
  rolled_back: '已回滚',
  pending: '待确认',
  applied: '已应用',
  rejected: '已拒绝',
  web: '网页',
  mcp: 'MCP',
  create: '新增',
  update: '修改',
  delete: '删除',
};
export const label = (value: string) => labels[value] ?? value;
export function Tag({ value }: { value: string }) {
  return <span className={`tag tag-${value}`}>{label(value)}</span>;
}
export function Modal({
  title,
  description,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content
          className="modal"
          onOpenAutoFocus={(event) => {
            const input = document.querySelector<HTMLInputElement>('.modal input');
            if (input) {
              event.preventDefault();
              input.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            if (returnFocus.current?.isConnected) {
              event.preventDefault();
              returnFocus.current.focus();
            }
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <div className="modal-header">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" disabled={busy} aria-label="关闭对话框">
              ×
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
type Input = z.input<typeof entityDataSchema>;
interface Field {
  name: FieldPath<Input>;
  type?: 'textarea' | 'date' | 'url';
  options?: readonly string[];
  choices?: Entity[];
  required?: boolean;
  hint?: string;
}
export function EntityForm({
  kind,
  projectId,
  existing,
  entities,
  onSave,
  onClose,
}: {
  kind: Kind;
  projectId?: string;
  existing?: Entity;
  entities: Entity[];
  onSave: (value: EntityData) => Promise<void>;
  onClose: () => void;
}) {
  const defaults = existing
    ? entityData(existing)
    : {
        kind,
        ...(kind === 'project'
          ? {
              name: '',
              environmentName: '正式环境',
              status: 'active',
              environmentStatus: 'not_set',
            }
          : {
              projectId,
              ...(kind === 'release'
                ? { version: '', status: 'draft' }
                : {
                    title: '',
                    priority: 'P2',
                    status: kind === 'feature' ? 'backlog' : kind === 'task' ? 'todo' : 'open',
                  }),
            }),
      };
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<Input, unknown, EntityData>({
    resolver: zodResolver(entityDataSchema),
    defaultValues: defaults as Input,
  });
  const [error, setFailure] = useState('');
  const features = entities.filter((e) => e.kind === 'feature' && e.projectId === projectId);
  const releases = entities.filter((e) => e.kind === 'release' && e.projectId === projectId);
  const fields: Field[] =
    kind === 'project'
      ? [
          { name: 'name', required: true },
          { name: 'description', type: 'textarea' },
          { name: 'repository', hint: '填写 owner/repo。仅用于手动读取 GitHub Actions。' },
          { name: 'status', options: projectStatuses },
          { name: 'environmentName', required: true },
          { name: 'environmentUrl', type: 'url' },
          { name: 'environmentStatus', options: environmentStatuses },
          { name: 'deployedVersion', hint: '手动记录实际部署版本，不由 Actions 自动修改。' },
        ]
      : kind === 'release'
        ? [
            { name: 'version', required: true },
            { name: 'status', options: releaseStatuses },
            { name: 'plannedDate', type: 'date' },
            { name: 'releasedDate', type: 'date', hint: '状态为已发布时必填。' },
            { name: 'notes', type: 'textarea' },
          ]
        : [
            { name: 'title', required: true },
            { name: 'description', type: 'textarea' },
            {
              name: 'status',
              options:
                kind === 'feature'
                  ? featureStatuses
                  : kind === 'task'
                    ? taskStatuses
                    : issueStatuses,
            },
            { name: 'priority', options: priorities },
            ...(kind === 'feature'
              ? ([
                  {
                    name: 'acceptanceCriteria',
                    type: 'textarea',
                    hint: '逐条记录可验证的完成条件。',
                  },
                  { name: 'plannedStart', type: 'date' },
                  { name: 'plannedEnd', type: 'date' },
                ] as Field[])
              : ([{ name: 'featureId', choices: features }] as Field[])),
            { name: 'targetReleaseId', choices: releases },
            ...(kind === 'task' ? ([{ name: 'dueDate', type: 'date' }] as Field[]) : []),
          ];
  return (
    <Modal
      title={`${existing ? '编辑' : '新建'}${kindNames[kind]}`}
      description={
        existing
          ? '保存后生成变更提案，确认具体内容后才会应用。'
          : '新增记录将直接保存；疑似重复的项目需要进一步确认。'
      }
      onClose={onClose}
      busy={isSubmitting}
    >
      <form
        noValidate
        onSubmit={handleSubmit(async (value) => {
          setFailure('');
          try {
            await onSave(value);
          } catch (err) {
            setFailure(errorText(err));
            setError('root.server', { message: errorText(err) });
          }
        })}
      >
        <div className="form-grid">
          {fields.map((field) => {
            const name = field.name;
            const fieldError = errors[name as keyof typeof errors];
            const message =
              fieldError && 'message' in fieldError ? String(fieldError.message ?? '') : '';
            const props = {
              ...register(name),
              disabled: isSubmitting,
              id: `field-${name}`,
              'aria-invalid': !!message,
              'aria-describedby': `${name}-hint ${name}-error`,
            };
            return (
              <div key={name} className={`field ${field.type === 'textarea' ? 'span-two' : ''}`}>
                <label htmlFor={`field-${name}`}>
                  {label(name)}
                  {field.required && <span className="required"> *</span>}
                </label>
                {field.type === 'textarea' ? (
                  <textarea {...props} rows={name === 'acceptanceCriteria' ? 4 : 3} />
                ) : field.options ? (
                  <select {...props}>
                    {field.options.map((option) => (
                      <option key={option} value={option}>
                        {label(option)}
                      </option>
                    ))}
                  </select>
                ) : field.choices ? (
                  <select {...props}>
                    <option value="">不关联</option>
                    {field.choices.map((e) => (
                      <option key={e.id} value={e.id}>
                        {entityLabel(e)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input {...props} type={field.type ?? 'text'} autoComplete="off" />
                )}
                <small id={`${name}-hint`}>{field.hint}</small>
                <span
                  id={`${name}-error`}
                  className="field-error"
                  role={message ? 'alert' : undefined}
                >
                  {message}
                </span>
              </div>
            );
          })}
        </div>
        {error && (
          <div className="alert" role="alert" tabIndex={-1} ref={(node) => node?.focus()}>
            {error}
          </div>
        )}
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={onClose} disabled={isSubmitting}>
            取消
          </button>
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? '正在提交…' : existing ? '生成变更提案' : '保存记录'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function RecordDetails({
  entity,
  entities,
}: {
  entity: EntityData | Entity | null;
  entities: Entity[];
}) {
  if (!entity) return <p className="muted">无记录</p>;
  return (
    <dl className="details">
      {Object.entries(entity)
        .filter(([key]) => !['createdAt', 'updatedAt'].includes(key))
        .map(([key, value]) => (
          <div key={key}>
            <dt>{label(key)}</dt>
            <dd>
              {['projectId', 'featureId', 'targetReleaseId'].includes(key)
                ? entities.find((e) => e.id === value)
                  ? `${entityLabel(entities.find((e) => e.id === value)!)} (${value})`
                  : String(value || '未设置')
                : String(value) === ''
                  ? '未设置'
                  : ['kind', 'status', 'environmentStatus'].includes(key)
                    ? label(String(value))
                    : String(value)}
            </dd>
          </div>
        ))}
    </dl>
  );
}
