import type { Diagnostic, NoteSnapshot, NoteType, Profile, RecognizedNote, Resolution } from '../types';
import { noteName } from '../config/paths';
import { containedKinds } from '../config/profile';
import { filled, isNoteLink, validateField, validDate } from '../config/validation';

export function linkTarget(link: string): string {
  return link.replace(/^\[\[|\]\]$/g, '').split(/[|#]/)[0] ?? '';
}
export function resolveTargets(link: string, paths: string[]): string[] {
  const target = linkTarget(link);
  const exact = paths.filter(path => path === target || path === `${target}.md`);
  if (exact.length)
    return exact;
  // Like Obsidian, a partial path such as "Other/Coast" matches any file ending in it.
  if (target.includes('/'))
    return paths.filter(path => path.endsWith(`/${target}`) || path.endsWith(`/${target}.md`));
  return paths.filter(path => noteName(path) === noteName(target));
}
export function inScope(path: string, scopes: string[]): boolean {
  return scopes.some(scope => path.startsWith(`${scope}/`));
}
function matches(value: unknown, expected: string, paths: string[]): boolean {
  if (value === expected)
    return true;
  if (!isNoteLink(value) || !isNoteLink(expected))
    return false;
  const actual = resolveTargets(value, paths);
  const wanted = resolveTargets(expected, paths);
  return actual.length === 1 && wanted.length === 1 && actual[0] === wanted[0];
}
function propertyDiagnostics(note: NoteSnapshot, type: NoteType): Diagnostic[] {
  const result: Diagnostic[] = [];
  const add = (message: string, capability: Diagnostic['capability']) => result.push({ path: note.path, message, capability });
  for (const field of type.fields) {
    const error = validateField(field, note.properties[field.key]);
    if (filled(error))
      add(error, 'configuration');
  }
  if (type.dated) {
    const start = note.properties[type.mappings.start];
    const end = note.properties[type.mappings.end];
    if (!validDate(start) || !validDate(end) || start > end)
      add('Missing, invalid, or reversed dates; dated operations are blocked', 'dates');
  }
  const activities = note.properties[type.mappings.activities];
  if (activities != null && activities !== '' && (!Array.isArray(activities) || !activities.every(isNoteLink)))
    add('Activity membership must be a note-link list', 'activities');
  return result;
}

/**
 * Trip kinds often share their recognition property (every preset trip links the same Travel Base), so what tells
 * them apart is what the note shows: the kinds whose Bases it embeds. A trip embedding none is the kind holding nothing.
 */
function byContents(candidates: NoteType[], note: NoteSnapshot, types: NoteType[]): string[] {
  if (!candidates.every(type => type.role === 'trip' && type.contains !== undefined))
    return candidates.map(type => type.id);
  const shown = containedKinds((note.embeds ?? []).join('\n'), types).map(type => type.id);
  return candidates.filter(type => shown.length
    ? shown.some(id => type.contains?.includes(id))
    : (type.contains?.length ?? 0) === 0).map(type => type.id);
}

/** One choice from candidates: a saved choice that is still a candidate, else the only one left. */
function pick(chosen: string | undefined, candidates: string[], fitting: string[]): string | undefined {
  if (filled(chosen) && candidates.includes(chosen))
    return chosen;
  return fitting.length === 1
    ? fitting[0]
    : undefined;
}

function recognize(note: NoteSnapshot, profile: Profile, types: Map<string, NoteType>, filePaths: string[], chosen: string | undefined): RecognizedNote | undefined {
  const candidates = profile.types.filter(type => matches(note.properties[type.recognition.property], type.recognition.value, filePaths)).map(type => type.id);
  const malformed = profile.types.some((type) => {
    const value = note.properties[type.recognition.property];
    return value != null && typeof value !== 'string';
  });
  if (!candidates.length && !malformed)
    return undefined;
  const fitting = candidates.length > 1
    ? byContents(candidates.flatMap(id => types.get(id) ?? []), note, profile.types)
    : candidates;
  const typeId = pick(chosen, candidates, fitting);
  const type = filled(typeId)
    ? types.get(typeId)
    : undefined;
  const diagnostics = type
    ? propertyDiagnostics(note, type)
    : [];
  if (!type) {
    diagnostics.push({
      path: note.path,
      message: malformed ? 'Recognition property has the wrong type' : 'Several types match; choose a type explicitly',
      capability: 'recognition',
    });
  }
  return {
    path: note.path,
    candidates,
    typeId,
    parentCandidates: [],
    diagnostics,
  };
}

interface Context { notes: NoteSnapshot[]; filePaths: string[]; types: Map<string, NoteType>; trips: RecognizedNote[] }

/** Resolves against every file, like Obsidian, then keeps trips: a link to some other note never falls through to a same-named trip. */
function parentCandidates(parent: unknown, { filePaths, trips }: Context): string[] {
  if (!isNoteLink(parent))
    return [];
  const tripPaths = trips.map(trip => trip.path);
  return resolveTargets(parent, [
    ...new Set([
      ...filePaths,
      ...tripPaths,
    ]),
  ]).filter(path => tripPaths.includes(path));
}

function dateDiagnostic(snapshot: NoteSnapshot | undefined, type: NoteType, parentPath: string, { notes, types, trips }: Context): string | undefined {
  const parentNote = notes.find(note => note.path === parentPath);
  const parentTypeId = trips.find(trip => trip.path === parentPath)?.typeId;
  const parentType = filled(parentTypeId)
    ? types.get(parentTypeId)
    : undefined;
  const from = parentType && parentNote?.properties[parentType.mappings.start];
  const to = parentType && parentNote?.properties[parentType.mappings.end];
  const start = snapshot?.properties[type.mappings.start];
  const end = snapshot?.properties[type.mappings.end];
  if (!validDate(from) || !validDate(to) || from > to)
    return 'Parent dates must be valid before dated creation or rescheduling';
  if (validDate(start) && validDate(end) && (start < from || end > to))
    return 'Entry is outside the trip range; explicitly correct its dates or extend the trip';
  return undefined;
}

function linkParent(recognized: RecognizedNote, type: NoteType, selected: string | undefined, context: Context): void {
  const snapshot = context.notes.find(note => note.path === recognized.path);
  const parent = snapshot?.properties[type.mappings.parent];
  // A note without a parent link is detached; that is a supported state, not a problem to report.
  if (parent === undefined || parent === null || parent === '') {
    recognized.detached = true;
    return;
  }
  recognized.parentCandidates = parentCandidates(parent, context);
  recognized.parentPath = pick(selected, recognized.parentCandidates, recognized.parentCandidates);
  if (!filled(recognized.parentPath)) {
    recognized.diagnostics.push({ path: recognized.path, message: 'Parent is invalid, ambiguous, unresolved, or outside discovery scope; choose an unambiguous trip target', capability: 'parent' });
    return;
  }
  const problem = type.dated
    ? dateDiagnostic(snapshot, type, recognized.parentPath, context)
    : undefined;
  if (filled(problem))
    recognized.diagnostics.push({ path: recognized.path, message: problem, capability: 'dates' });
}

export function buildIndex(profile: Profile, notes: NoteSnapshot[], filePaths: string[], resolutions: Record<string, Resolution> = {}): RecognizedNote[] {
  const types = new Map(profile.types.map(type => [type.id, type]));
  const result = notes
    .filter(note => inScope(note.path, profile.scopes))
    .flatMap(note => recognize(note, profile, types, filePaths, resolutions[note.path]?.typeId) ?? []);
  const typeOf = (note: RecognizedNote) => filled(note.typeId)
    ? types.get(note.typeId)
    : undefined;
  const context: Context = {
    notes,
    filePaths,
    types,
    trips: result.filter(note => typeOf(note)?.role === 'trip'),
  };
  for (const recognized of result) {
    const type = typeOf(recognized);
    if (type && type.role !== 'trip')
      linkParent(recognized, type, resolutions[recognized.path]?.parentPath, context);
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
