import { moment } from 'obsidian';
import { validDate } from '../config/validation';

const ISO = 'YYYY-MM-DD';
function parse(date: string): moment.Moment {
  if (!validDate(date))
    throw new Error('Enter a valid YYYY-MM-DD date');
  return moment.utc(date, ISO, true);
}
export function addDays(date: string, offset: number): string {
  if (!Number.isSafeInteger(offset))
    throw new TypeError('Day offset must be an integer');
  const result = parse(date).add(offset, 'days').format(ISO);
  if (!validDate(result))
    throw new Error('Date is outside years 0001–9999');
  return result;
}
export function dayOffset(from: string, to: string): number {
  return parse(to).diff(parse(from), 'days');
}
export function assertRange(start: unknown, end: unknown): asserts start is string {
  if (!validDate(start) || !validDate(end) || start > end)
    throw new Error('Set valid ordered start and end dates');
}
export function inclusiveDays(start: string, end: string): string[] {
  assertRange(start, end);
  const nights = dayOffset(start, end);
  return Array.from({ length: nights + 1 }, (_, day) => addDays(start, day));
}
/** Any Moment.js format, in Obsidian's language, like the core Templates plugin. */
export function formatDate(date: string, format: string): string {
  return parse(date).format(format);
}
/** The date a heading names in `format`, or undefined; matching is strict, so other headings never count. */
export function parseDate(text: string, format: string): string | undefined {
  const value = moment.utc(text, format, true);
  return value.isValid()
    ? value.format(ISO)
    : undefined;
}
/** A day-heading format must name the day exactly, so headings it writes can be read back as the same date. */
export function readableDayFormat(format: string): boolean {
  return !/[\r\n#]/.test(format) && format.trim() !== ''
    && [
      '2026-01-01',
      '2026-02-28',
      '2026-12-31',
      '2027-07-04',
    ].every(date => parseDate(formatDate(date, format), format) === date);
}
