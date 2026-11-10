import type { Entity, DuplicateCandidate } from '../../shared/schema';
import { AppError } from './errors';

export function validateRelationships(entities: Map<string, Entity>): void {
  const versions = new Set<string>();
  for (const entity of entities.values()) {
    if (entity.kind === 'project') continue;
    const project = entities.get(entity.projectId);
    if (project?.kind !== 'project')
      throw new AppError('INVALID_REFERENCE', '所属项目不存在，或仍有记录引用被删除的项目');
    const check = (id: string, kind: 'feature' | 'release') => {
      if (!id) return;
      const related = entities.get(id);
      if (!related || related.kind !== kind || related.projectId !== entity.projectId)
        throw new AppError('INVALID_REFERENCE', '关联功能或版本必须属于同一个项目，且不能已被删除');
    };
    if (entity.kind === 'feature' || entity.kind === 'task' || entity.kind === 'issue')
      check(entity.targetReleaseId, 'release');
    if (entity.kind === 'task' || entity.kind === 'issue') check(entity.featureId, 'feature');
    if (entity.kind === 'release') {
      const key = entity.projectId + ':' + entity.version.toLocaleLowerCase();
      if (versions.has(key)) throw new AppError('DUPLICATE_VERSION', '同一项目中已存在这个版本号');
      versions.add(key);
    }
  }
}
function normalized(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}
function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) return true;
  if (Math.min(a.length, b.length) < 6 || Math.abs(a.length - b.length) > 2) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(
        row[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + Number(a[i - 1] !== b[j - 1]),
      );
    previous = row;
  }
  return previous[b.length] <= 2;
}
export function findDuplicates(
  entities: Map<string, Entity>,
  touched: Set<string>,
): DuplicateCandidate[] {
  const projects = [...entities.values()].filter((e) => e.kind === 'project');
  const found: DuplicateCandidate[] = [];
  for (const project of projects) {
    if (!touched.has(project.id)) continue;
    for (const other of projects) {
      if (project.id === other.id) continue;
      const sameRepository =
        !!project.repository &&
        project.repository.toLocaleLowerCase() === other.repository.toLocaleLowerCase();
      if (sameRepository || near(normalized(project.name), normalized(other.name)))
        found.push({
          proposedId: project.id,
          existingId: other.id,
          name: other.name,
          reason: sameRepository ? 'GitHub 仓库相同' : '项目名称相似',
        });
    }
  }
  return found;
}
