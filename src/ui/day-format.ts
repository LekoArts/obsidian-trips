import type { DayFormatMismatch } from '../travel/day-sections';
import type { NoteType, RecognizedNote } from '../types';
import { filled } from '../config/validation';
import { dayFormatMismatch } from '../travel/day-sections';

/** "A, B and C", or "A, B or C". */
function listText(items: string[], last = 'and'): string {
  return items.map((item, index) => item + (index < items.length - 2
    ? ', '
    : index === items.length - 2
      ? ` ${last} `
      : '')).join('');
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
/** A kind whose existing notes have day headings in another date format, and what to tell the person about it. */
export interface DayFormatOffer { type: NoteType; suggestion?: string; message: string }
/**
 * Checked once, right after a setup is installed on a vault that already has notes: their day headings may use
 * another date format than the setup's, and would silently not be read as days. Kind-wide, so a switch is only offered
 * when it reads every heading of the kind.
 */
export function dayFormatOffers(types: NoteType[], index: RecognizedNote[], headings: (path: string, level: number) => string[]): DayFormatOffer[] {
  return types.filter(type => type.role === 'entry' && type.days.enabled).flatMap((type) => {
    const format = type.days.dateFormat;
    const mismatch = dayFormatMismatch(index.filter(note => note.typeId === type.id).flatMap(note => headings(note.path, type.days.headingLevel)), format);
    if (!mismatch)
      return [];
    if (filled(mismatch.suggestion)) {
      return [
        { type, suggestion: mismatch.suggestion, message: `Your ${type.label} notes write day headings as ${mismatch.suggestion} (like ${mismatch.example}), but this setup uses ${format}. Use ${mismatch.suggestion} so they're read as days? Your notes stay as they are.` },
      ];
    }
    const group = mismatch.formats[0]!;
    return [
      {
        type,
        message: !mismatch.mixed && mismatch.formats.length === 1
          ? `Your ${type.label} day headings, like ${mismatch.example}, could be ${listText(group, 'or')}, so they aren't read as days. Set the one you use under ${type.label} → Day-heading format.`
          : `Your ${type.label} day headings mix ${mixText(mismatch, format)}; only ${format} is read as days. Use one format in the notes, then set it under ${type.label} → Day-heading format.`,
      },
    ];
  });
}
