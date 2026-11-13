import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { projectWorkProgress } from '../web/project-progress';
import { entityDataSchema, type Entity } from '../shared/schema';
const projectId = randomUUID();
function record(kind: 'task' | 'issue', status: string, owner = projectId): Entity {
  return {
    ...entityDataSchema.parse({ kind, status, projectId: owner, title: 'Test' }),
    id: randomUUID(),
    revision: 1,
    createdAt: '',
    updatedAt: '',
  };
}
describe('project work progress', () => {
  it('counts each task state and excludes other projects and issues', () => {
    const records = ['todo', 'in_progress', 'blocked', 'done'].map((s) => record('task', s));
    records.push(record('task', 'done', randomUUID()), record('issue', 'resolved'));
    expect(projectWorkProgress(records, projectId, 'task')).toEqual({
      total: 4,
      completed: 1,
      waiting: 1,
      active: 1,
      blocked: 1,
    });
  });
  it('counts resolved and closed issues as processed, independently of tasks', () => {
    const records = ['open', 'in_progress', 'resolved', 'closed'].map((s) => record('issue', s));
    records.push(record('task', 'done'), record('issue', 'closed', randomUUID()));
    expect(projectWorkProgress(records, projectId, 'issue')).toEqual({
      total: 4,
      completed: 2,
      waiting: 1,
      active: 1,
      blocked: 0,
    });
  });
  it('handles empty projects and recomputes from changed snapshots', () => {
    expect(projectWorkProgress([], projectId, 'task').total).toBe(0);
    const task = record('task', 'todo');
    expect(projectWorkProgress([task], projectId, 'task').completed).toBe(0);
    expect(
      projectWorkProgress([{ ...task, status: 'done' } as Entity], projectId, 'task').completed,
    ).toBe(1);
    expect(projectWorkProgress([], projectId, 'issue')).toEqual({
      total: 0,
      completed: 0,
      waiting: 0,
      active: 0,
      blocked: 0,
    });
  });
});
