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
/** What follows item `index` of `count` in a running list: "A, B and C", or "A, B or C". */
export function listSeparator(index: number, count: number, last = 'and'): string {
  return index < count - 2
    ? ', '
    : index === count - 2
      ? ` ${last} `
      : '';
}
function listText(items: string[], last = 'and'): string {
  return items.map((item, index) => item + listSeparator(index, items.length, last)).join('');
}
/** "DD.MM.YYYY and either DD/MM/YYYY or MM/DD/YYYY", led by the configured format when some headings use it. */
function mixText(mismatch: DayFormatMismatch, format: string): string {
  const others = listText(mismatch.formats.map(group => group.length > 1
    ? `either ${listText(group, 'or')}`
    : group[0]!));
  return mismatch.mixed
    ? `${format} with ${others}`
    : others;
}
/** The formats a lone set of ambiguous headings could be, when nothing else tells them apart. */
function choices(mismatch: DayFormatMismatch): string | undefined {
  const group = mismatch.formats[0]!;
  return !mismatch.mixed && mismatch.formats.length === 1 && group.length > 1
    ? listText(group, 'or')
    : undefined;
}
/** How to make day headings readable again: switch to the one format they use, else say which formats were found. */
export function formatFix(mismatch: DayFormatMismatch, format: string): string {
  if (filled(mismatch.suggestion))
    return `Switch the day-heading format to ${mismatch.suggestion} in Trips settings.`;
  const either = choices(mismatch);
  return filled(either)
    ? `They could be ${either}: set the one you use in Trips settings.`
    : `They mix ${mixText(mismatch, format)}; only ${format} is read.`;
}
/** Says which other formats the kind's day headings use, so the person knows whether one switch fixes them. */
export function formatWarning(type: NoteType, mismatch: DayFormatMismatch): string {
  const format = type.days.dateFormat;
  if (filled(mismatch.suggestion))
    return `Your ${type.label} notes use a different format for day headings: ${mismatch.suggestion} (like ${mismatch.example}). They aren’t read as days until you switch.`;
  const either = choices(mismatch);
  return filled(either)
    ? `Your ${type.label} day headings, like ${mismatch.example}, could be ${either}, so they aren’t read as days. Set the one you use here.`
    : `Your ${type.label} day headings mix ${mixText(mismatch, format)}; only ${format} is read as days. Use one format in the notes, then set it here.`;
}
