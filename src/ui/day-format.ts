import type { DayFormatMismatch } from '../travel/day-sections';
import type { NoteType, RecognizedNote } from '../types';
import { filled } from '../config/validation';
import { dayFormatMismatch } from '../travel/day-sections';

/**
 * Judged across every note of the kind in the vault, like the setting it points to, so the trip tab and settings always
 * agree and a switch is never offered that would stop another trip's headings being read.
 */
export function kindDayFormatMismatch(type: NoteType, index: RecognizedNote[], headings: (path: string, level: number) => string[]): DayFormatMismatch | undefined {
  return type.role === 'entry'
    ? dayFormatMismatch(index.filter(note => note.typeId === type.id).flatMap(note => headings(note.path, type.days.headingLevel)), type.days.dateFormat)
    : undefined;
}
/** What follows item `index` of `count` in a running list: "A, B and C". */
export function listSeparator(index: number, count: number): string {
  return index < count - 2
    ? ', '
    : index === count - 2
      ? ' and '
      : '';
}
/** "A, B and C". */
function listText(items: string[]): string {
  return items.map((item, index) => item + listSeparator(index, items.length)).join('');
}
/** Every format the headings are written in, the configured one last when some use it. */
function usedFormats(mismatch: DayFormatMismatch, format: string): string[] {
  return [
    ...mismatch.formats,
    ...(mismatch.mixed
      ? [format]
      : []),
  ];
}
/** How to make day headings readable again: switch to the one format they use, else say which formats are mixed. */
export function formatFix(mismatch: DayFormatMismatch, format: string): string {
  if (filled(mismatch.suggestion))
    return `Switch the day-heading format to ${mismatch.suggestion} in Trips settings.`;
  const used = usedFormats(mismatch, format);
  return used.length > 1
    ? `They mix ${listText(used)}; only ${format} is read.`
    : `Only ${format} is read.`;
}
/** Says which other formats the kind's day headings use, so the person knows whether one switch fixes them. */
export function formatWarning(type: NoteType, mismatch: DayFormatMismatch): string {
  const format = type.days.dateFormat;
  if (filled(mismatch.suggestion))
    return `Your ${type.label} notes use a different format for day headings: ${mismatch.suggestion} (like ${mismatch.example}). They aren’t read as days until you switch.`;
  const used = usedFormats(mismatch, format);
  return used.length > 1
    ? `Your ${type.label} day headings mix ${listText(used)}; only ${format} is read as days. Use one format in the notes, then set it here.`
    : `Some ${type.label} day headings, like ${mismatch.example}, aren’t in this format, so they aren’t read as days.`;
}
