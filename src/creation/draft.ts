import type { NoteType, RecognizedNote } from '../types';
import type { CreationDraft, CreationIO, ParentNote } from './create';
import { filled } from '../config/validation';
import { capture } from '../editing/conflicts';
import { parseFields } from '../ui/creation/fields';

export interface DraftInput {
  type: NoteType;
  name: string;
  start?: string;
  end?: string;
  /** Field values as the form holds them: text, with list items on separate lines. */
  fields: Record<string, string>;
  /** The trip a day plan, stop or activity belongs to. */
  parentPath?: string;
  activities?: { link: string; day?: string }[];
}
export interface DraftContext {
  io: CreationIO;
  index: RecognizedNote[];
  types: NoteType[];
  /** The link text Obsidian would write for `path` in a note at `from`. */
  linkText: (path: string, from: string) => string;
}

async function parentNote(context: DraftContext, path: string): Promise<ParentNote> {
  const note = context.index.find(note => note.path === path);
  if (!filled(note?.typeId) || note.diagnostics.some(d => d.capability === 'recognition'))
    throw new Error('The trip needs attention first; run "Review notes that need attention"');
  const type = context.types.find(item => item.id === note.typeId);
  if (!type)
    throw new Error('Configure this kind in settings first');
  if (type.role !== 'trip')
    throw new Error('Choose a trip');
  return {
    ...await capture(context.io, path),
    type,
  };
}

/** The creation draft for what the form or another caller asked for, with the parent read and the fields parsed. */
export async function buildDraft(input: DraftInput, context: DraftContext): Promise<CreationDraft> {
  const { type } = input;
  const parent = type.role === 'trip'
    ? undefined
    : await parentNote(context, input.parentPath ?? '');
  return {
    type,
    name: input.name,
    start: filled(input.start)
      ? input.start
      : undefined,
    end: filled(input.end)
      ? input.end
      : undefined,
    fields: parseFields(type.fields, input.fields),
    parent,
    parentLink: parent && context.linkText(parent.path, parent.path),
    activities: input.activities,
  };
}
