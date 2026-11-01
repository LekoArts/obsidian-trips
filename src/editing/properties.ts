import type { YamlCodec } from '../config/template-render';
import type { ParentNote } from '../creation/create';
import type { NoteType } from '../types';
import type { FileSnapshot, ReadIO } from './conflicts';
import { parseProperties, splitNote } from '../config/template-render';
import { filled, validateField, validDate } from '../config/validation';
import { assertWithinParent } from '../creation/create';
import { assertFresh } from './conflicts';

export interface PropertyIO extends ReadIO {
  codec: YamlCodec;
  updateProperties: (expected: FileSnapshot, update: (properties: Record<string, unknown>) => void) => Promise<void>;
}
function fieldChangeProblem(type: NoteType, key: string, value: unknown): string | undefined {
  const field = type.fields.find(field => field.key === key);
  const protectedKeys = [
    type.mappings.parent,
    type.mappings.activities,
    type.baseProperty,
    type.recognition.property,
  ];
  if (!field || protectedKeys.includes(key))
    return `Property is not editable here: ${key}`;
  return validateField(field, value);
}
export function validatePropertyChanges(type: NoteType, current: Record<string, unknown>, changes: Record<string, unknown>): void {
  const dates = [type.mappings.start, type.mappings.end].filter(Boolean);
  for (const [key, value] of Object.entries(changes)) {
    const invalid = dates.includes(key)
      ? (validDate(value)
          ? undefined
          : `${key} must be a YYYY-MM-DD date`)
      : fieldChangeProblem(type, key, value);
    if (filled(invalid))
      throw new Error(invalid);
  }
  if (dates.some(key => Object.hasOwn(changes, key))) {
    const next = {
      ...current,
      ...changes,
    };
    const start = next[type.mappings.start];
    const end = next[type.mappings.end];
    if (!validDate(start) || !validDate(end) || start > end)
      throw new Error('Set valid ordered start and end dates together');
  }
}
export async function editProperties(io: PropertyIO, expected: FileSnapshot, type: NoteType, changes: Record<string, unknown>, parent?: ParentNote): Promise<void> {
  await assertFresh(io, expected);
  const current = parseProperties(splitNote(expected.content).yaml, io.codec);
  validatePropertyChanges(type, current, changes);
  if (type.role !== 'trip' && [type.mappings.start, type.mappings.end].some(key => Object.hasOwn(changes, key))) {
    if (!parent)
      throw new Error('Choose an unambiguous parent trip before editing dates');
    await assertFresh(io, parent);
    const next = {
      ...current,
      ...changes,
    };
    const start = next[type.mappings.start];
    const end = next[type.mappings.end];
    if (!validDate(start) || !validDate(end))
      throw new Error('Invalid entry dates');
    assertWithinParent(parent, start, end, io.codec);
  }
  await io.updateProperties(expected, (properties) => {
    validatePropertyChanges(type, properties, changes);
    for (const [key, value] of Object.entries(changes)) properties[key] = value;
  });
}
