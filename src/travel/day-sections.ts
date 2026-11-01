import type { DaySections } from '../types';
import { filled } from '../config/validation';
import { formatDate, inclusiveDays, parseDate } from './dates';

export interface Heading { start: number; end: number; level: number; text: string }
export interface ContentLine { line: string; text: string; start: number }

interface Fence { char: string; length: number }
/**
 * Tracks `%%` and HTML comments line by line, reading delimiters in order (inside one kind of comment the other
 * kind's delimiters are text). `open` says a comment is still unclosed, so the rest of the body is commented out.
 */
function commentTracker(): { test: (text: string) => boolean; open: () => boolean } {
  let closer: string | undefined;
  const test = (line: string): boolean => {
    // Delimiters inside inline code are code, not comments.
    const text = line.replace(/(`+)[^`][\s\S]*?\1/g, '');
    let commented = closer !== undefined;
    let at = 0;
    for (;;) {
      if (closer !== undefined) {
        const end = text.indexOf(closer, at);
        if (end < 0)
          break;
        at = end + closer.length;
        closer = undefined;
        continue;
      }
      const percent = text.indexOf('%%', at);
      const html = text.indexOf('<!--', at);
      if (percent < 0 && html < 0)
        break;
      commented = true;
      const isPercent = html < 0 || (percent >= 0 && percent < html);
      closer = isPercent ? '%%' : '-->';
      at = isPercent
        ? percent + 2
        : html + 4;
    }
    return commented;
  };
  return {
    test,
    open: () => closer !== undefined,
  };
}
function fenceOpening(text: string): Fence | undefined {
  const marker = /^ {0,3}(`{3,}(?!`)|~{3,}(?!~))(.*)$/.exec(text);
  const run = marker?.[1];
  if (!filled(run) || (run[0] === '`' && marker?.[2]?.includes('`') === true))
    return undefined;
  return { char: run[0] ?? '', length: run.length };
}
function closesFence(text: string, fence: Fence): boolean {
  const marker = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(text);
  return marker?.[1]?.[0] === fence.char && marker[1].length >= fence.length;
}
/**
 * The lines of a body that are Markdown content: lines inside fenced code, `%%` comments or HTML comments are left
 * out, and so is any line that opens or closes a comment, so commented-out headings and bullets are never edited.
 * `openFence` and `openComment`: the body ends inside a fence or a comment, which callers refuse to edit.
 */
export function contentLines(body: string): { lines: ContentLine[]; openFence: boolean; openComment: boolean } {
  const lines: ContentLine[] = [];
  const comments = commentTracker();
  let offset = 0;
  let fence: Fence | undefined;
  for (const line of body.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const text = line.replace(/\r?\n$/, '');
    if (fence) {
      if (closesFence(text, fence))
        fence = undefined;
    }
    else if (!comments.test(text)) {
      fence = fenceOpening(text);
      if (!fence)
        lines.push({ line, text, start: offset });
    }
    offset += line.length;
  }
  return {
    lines,
    openFence: fence !== undefined,
    openComment: comments.open(),
  };
}
export function headings(body: string): Heading[] {
  const { lines, openFence, openComment } = contentLines(body);
  if (openFence)
    throw new Error('Close the fenced code block in this note first');
  if (openComment)
    throw new Error('Close the %% or <!-- --> comment in this note first');
  return lines.flatMap(({ line, text, start }) => {
    const heading = /^ {0,3}(#{1,6})[ \t]+([^ \t].*)?$/.exec(text);
    return heading
      ? [
          {
            start,
            end: start + line.length,
            level: heading[1]?.length ?? 0,
            text: (heading[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim(),
          },
        ]
      : [];
  });
}
export interface DaySection { date: string; heading: Heading; end: number; activity?: Heading; activityEnd?: number }
export function daySections(body: string, config: DaySections): DaySection[] {
  const all = headings(body);
  const days: DaySection[] = [];
  for (const heading of all) {
    if (heading.level !== config.headingLevel)
      continue;
    const date = parseDate(heading.text, config.dateFormat);
    if (!filled(date))
      continue;
    if (days.some(day => day.date === date))
      throw new Error(`Duplicate date heading: ${date}. Correct the template; nothing was created.`);
    const end = all.find(next => next.start > heading.start && next.level <= heading.level)?.start ?? body.length;
    const activities = all.filter(next => next.start > heading.start && next.start < end && next.level === config.activityLevel && next.text === config.activityHeading);
    if (activities.length > 1)
      throw new Error(`Duplicate ${config.activityHeading} subsections for ${date}. Correct the template; nothing was created.`);
    const activity = activities[0];
    const activityEnd = activity
      ? all.find(next => next.start > activity.start && next.level <= activity.level)?.start ?? body.length
      : undefined;
    days.push({
      date,
      heading,
      end,
      activity,
      activityEnd,
    });
  }
  return days;
}
/** Ways people commonly write a date in a heading, tried when headings don't match the configured format. */
const COMMON_DAY_FORMATS = [
  'YYYY-MM-DD',
  'DD.MM.YYYY',
  'D.M.YYYY',
  'D. MMMM YYYY',
  'DD/MM/YYYY',
  'D/M/YYYY',
  'MM/DD/YYYY',
  'M/D/YYYY',
  'DD-MM-YYYY',
  'YYYY/MM/DD',
  'YYYY.MM.DD',
  'D MMMM YYYY',
  'MMMM D, YYYY',
  'dddd, D MMMM YYYY',
  'dddd, MMMM D, YYYY',
  'ddd, D MMM YYYY',
  'ddd, MMM D, YYYY',
];
/**
 * Day headings that look like dates but aren't in the configured format, so they silently aren't days.
 * `formats`: the fewest groups of formats that explain those headings, most headings first. Each group lists every
 * format that explains its headings equally, so nothing is guessed: 05/06/2026 alone is [DD/MM/YYYY, MM/DD/YYYY],
 * while next to 11/25/2026 it is [MM/DD/YYYY]. `mixed`: some headings do use the configured format. `suggestion`: the
 * single format explaining them all, only when no heading uses the configured format, so switching never stops other
 * headings being read.
 */
export interface DayFormatMismatch { example: string; formats: string[][]; mixed: boolean; suggestion?: string }
export function dayFormatMismatch(texts: string[], format: string): DayFormatMismatch | undefined {
  const reads = (candidate: string, text: string) => filled(parseDate(text, candidate));
  const read = texts.filter(text => reads(format, text));
  const dated = texts.filter(text => !reads(format, text)).map(text => ({
    text,
    fits: COMMON_DAY_FORMATS.filter(candidate => reads(candidate, text)),
  })).filter(heading => heading.fits.length);
  const example = dated[0]?.text;
  if (!filled(example))
    return undefined;
  const formats: string[][] = [];
  let left = dated;
  while (left.length) {
    const explained = (candidate: string) => left.filter(heading => heading.fits.includes(candidate));
    const best = COMMON_DAY_FORMATS.reduce((top, candidate) => explained(candidate).length > explained(top).length
      ? candidate
      : top);
    const group = explained(best);
    formats.push(COMMON_DAY_FORMATS.filter(candidate => group.every(heading => heading.fits.includes(candidate))));
    left = left.filter(heading => !group.includes(heading));
  }
  const only = formats.length === 1 && formats[0]!.length === 1
    ? formats[0]![0]
    : undefined;
  return {
    example,
    formats,
    mixed: read.length > 0,
    ...(read.length === 0 && filled(only)
      ? { suggestion: only }
      : {}),
  };
}
function separator(before: string, newline: string): string {
  return before.endsWith(newline + newline)
    ? ''
    : before.endsWith(newline)
      ? newline
      : before
        ? newline + newline
        : '';
}
export function generateDays(body: string, start: string, end: string, config: DaySections): string {
  if (!config.enabled)
    return body;
  const dates = inclusiveDays(start, end);
  const existing = daySections(body, config);
  const newline = body.includes('\r\n')
    ? '\r\n'
    : '\n';
  const activity = `${'#'.repeat(config.activityLevel)} ${config.activityHeading}${newline}${newline}`;
  let output = body;
  for (const day of [...existing].reverse()) {
    if (dates.includes(day.date) && !day.activity)
      output = output.slice(0, day.end) + separator(output.slice(0, day.end), newline) + activity + output.slice(day.end);
  }
  for (const date of dates) {
    if (!existing.some(day => day.date === date))
      output += `${separator(output, newline)}${'#'.repeat(config.headingLevel)} ${formatDate(date, config.dateFormat)}${newline}${newline}${activity}`;
  }
  return output;
}
