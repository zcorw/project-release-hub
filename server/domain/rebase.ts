import { entityData, type Entity, type EntityData } from '../../shared/schema';

// Entity data consists of scalar strings. Text conflicts are resolved as whole fields.
export function mergeFields(base: Entity, current: Entity, proposed: EntityData) {
  const original = entityData(base) as unknown as Record<string, string>;
  const latest = entityData(current) as unknown as Record<string, string>;
  const wanted = proposed as unknown as Record<string, string>;
  const merged = { ...latest };
  const conflicts: string[] = [];
  for (const field of Object.keys(wanted)) {
    if (wanted[field] === original[field]) continue;
    if (latest[field] === original[field] || latest[field] === wanted[field])
      merged[field] = wanted[field];
    else conflicts.push(field);
  }
  return { merged: merged as EntityData, conflicts };
}

export function sameData(left: EntityData, right: EntityData): boolean {
  const a = left as unknown as Record<string, string>;
  const b = right as unknown as Record<string, string>;
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) => a[key] === b[key])
  );
}
