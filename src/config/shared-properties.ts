import type { NoteType } from '../types';

export type SharedKey = 'start' | 'end' | 'parent' | 'activities' | 'base';
export function appliesTo(type: NoteType, key: SharedKey): boolean {
  if (key === 'parent')
    return type.role !== 'trip';
  if (key === 'start' || key === 'end')
    return type.dated;
  if (key === 'activities')
    return type.role !== 'activity';
  return !!type.basePath;
}
export function propertyOf(type: NoteType, key: SharedKey): string {
  return key === 'base'
    ? type.baseProperty
    : type.mappings[key];
}
export function setProperty(type: NoteType, key: SharedKey, value: string): void {
  if (key === 'base')
    type.baseProperty = value; else
    type.mappings[key] = value;
}

/** The property name most kinds use for this purpose; ties go to the earliest kind. */
export function sharedValue(types: NoteType[], key: SharedKey): string {
  const counts = new Map<string, number>();
  for (const type of types) {
    const value = propertyOf(type, key);
    if (appliesTo(type, key) && value)
      counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best = '';
  for (const [value, count] of counts) {
    if (count > (counts.get(best) ?? 0))
      best = value;
  }
  return best;
}

/** Kinds that follow the shared name (or have none). Captured once per edit so typing can't pull in overrides. */
export function sharedFollowers(types: NoteType[], key: SharedKey): NoteType[] {
  const shared = sharedValue(types, key);
  return types.filter(type => appliesTo(type, key) && (!propertyOf(type, key) || propertyOf(type, key) === shared));
}
export function differsFromShared(type: NoteType, types: NoteType[], key: SharedKey): boolean {
  return appliesTo(type, key) && propertyOf(type, key) !== sharedValue(types, key);
}
