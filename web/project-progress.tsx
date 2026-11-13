import React from 'react';
import type { Entity } from '../shared/schema';

export function projectWorkProgress(entities: Entity[], projectId: string, kind: 'task' | 'issue') {
  const records = entities.filter((e) => e.kind === kind && e.projectId === projectId);
  const count = (status: string) =>
    records.filter((e) => 'status' in e && e.status === status).length;
  return {
    total: records.length,
    completed: kind === 'task' ? count('done') : count('resolved') + count('closed'),
    active: count('in_progress'),
    waiting: count(kind === 'task' ? 'todo' : 'open'),
    blocked: kind === 'task' ? count('blocked') : 0,
  };
}

export function ProjectWorkProgress({
  entities,
  projectId,
  projectName,
  kind,
}: {
  entities: Entity[];
  projectId: string;
  projectName: string;
  kind: 'task' | 'issue';
}) {
  const progress = projectWorkProgress(entities, projectId, kind);
  const title = kind === 'task' ? '任务进度' : '问题进度';
  return (
    <section className="project-work-progress" aria-label={`${projectName}${title}`}>
      <div className="row">
        <strong className="small">{title}</strong>
        {progress.total > 0 && (
          <span className="muted small">
            {progress.completed} / {progress.total} {kind === 'task' ? '已完成' : '已解决或关闭'}
          </span>
        )}
      </div>
      {progress.total === 0 ? (
        <p className="small muted">{kind === 'task' ? '暂无任务' : '暂无问题'}</p>
      ) : (
        <>
          <div
            className="progress"
            role="progressbar"
            aria-label={`${projectName}${title}`}
            aria-valuemin={0}
            aria-valuenow={progress.completed}
            aria-valuemax={progress.total}
          >
            <span style={{ width: `${(100 * progress.completed) / progress.total}%` }} />
          </div>
          <div className="small muted">
            {progress.waiting} {kind === 'task' ? '待办' : '待处理'} · {progress.active}{' '}
            {kind === 'task' ? '进行中' : '处理中'}
            {kind === 'task' && <> · {progress.blocked} 受阻</>}
          </div>
        </>
      )}
    </section>
  );
}
