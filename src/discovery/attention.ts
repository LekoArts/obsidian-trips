import type { NoteType, RecognizedNote } from '../types';
import { noteName } from '../config/paths';
import { filled } from '../config/validation';

export interface AttentionItem { path: string; label: string; context: string; problem: string }

function isoDate(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value
    : '';
}

/** Notes with problems, newest trip first. Unresolved notes fall back to their own dates, then the year in their path. */
export function attentionItems(notes: RecognizedNote[], types: NoteType[], properties: Map<string, Record<string, unknown>>): AttentionItem[] {
  const byId = new Map(types.map(type => [type.id, type]));
  const byPath = new Map(notes.map(note => [note.path, note]));
  const kindsOf = (note: RecognizedNote | undefined) => (filled(note?.typeId)
    ? [note.typeId]
    : note?.candidates ?? []).flatMap(id => byId.get(id) ?? []);
  const start = (path: string | undefined) => filled(path)
    ? kindsOf(byPath.get(path)).map(type => isoDate(properties.get(path)?.[type.mappings.start])).find(Boolean) ?? ''
    : '';
  return notes.filter(note => note.diagnostics.length).map((note) => {
    const kinds = kindsOf(note);
    const isTrip = kinds.length > 0 && kinds.every(type => type.role === 'trip');
    const trip = isTrip ? note.path : note.parentPath;
    const sort = start(trip) || start(note.path) || (note.path.match(/(?:^|\/)((?:19|20)\d\d)\//)?.[1] ?? '');
    const diagnostic = note.diagnostics[0];
    const problem = diagnostic?.capability === 'recognition' && note.candidates.length > 1
      ? 'Matches several kinds; choose one'
      : diagnostic?.capability === 'parent'
        ? note.parentCandidates.length > 1
          ? 'Links to several trips; choose one'
          : 'Its trip link doesn’t lead to a trip'
        : diagnostic?.message.split(';')[0] ?? '';
    const folder = note.path.includes('/')
      ? note.path.slice(0, note.path.lastIndexOf('/'))
      : '';
    return {
      item: {
        path: note.path,
        label: noteName(note.path),
        context: isTrip
          ? 'Trip'
          : filled(trip)
            ? noteName(trip)
            : folder,
        problem,
      },
      sort,
    };
  }).sort((a, b) => b.sort.localeCompare(a.sort) || a.item.context.localeCompare(b.item.context) || a.item.path.localeCompare(b.item.path)).map(entry => entry.item);
}
