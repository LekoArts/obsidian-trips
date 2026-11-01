import type { DaySections } from '../types';
import type { Span } from './schedule';
import { filled, isNoteLink, validDate } from '../config/validation';
import { contentLines, daySections, generateDays } from './day-sections';
import { validSpan } from './schedule';

export type LinkResolver = (link: string) => string | undefined;
export interface Occurrence { date: string; link: string; start: number; end: number }
export function dailyOccurrences(body: string, config: DaySections): Occurrence[] {
  const sections = daySections(body, config);
  const result: Occurrence[] = [];
  for (const { line, start } of contentLines(body).lines) {
    const bullet = /^ {0,3}[-*+] +(?<link>\[\[[^\]\r\n]+\]\])[ \t]*(?:\r?\n)?$/.exec(line);
    const section = sections.find(day => day.activity && start >= day.activity.end && start < (day.activityEnd ?? day.end));
    if (filled(bullet?.groups?.link) && section) {
      result.push({
        date: section.date,
        link: bullet.groups.link,
        start,
        end: start + line.length,
      });
    }
  }
  return result;
}
// Removing a bullet that sits between two blank lines also drops one of them, so add-then-remove leaves the note as it was.
function removeLine(text: string, start: number, end: number): string {
  const before = text.slice(0, start);
  const blank = /(?:^|\n)[ \t]*\r?\n$/.test(before)
    ? /^[ \t]*\r?\n/.exec(text.slice(end))?.[0].length ?? 0
    : 0;
  return before + text.slice(end + blank);
}
export type AssignmentAction = 'general-add' | 'day-add' | 'day-remove' | 'full-remove' | 'reassign';
/**
 * `linkText` is what gets written inside `[[…]]`; it defaults to the target path and must resolve to it.
 * `index` places the bullet among that day's activities (0 = first); without it, it goes last.
 * `reassign` with `fromDay === day` reorders within the day.
 */
export interface AssignmentRequest { action: AssignmentAction; target: string; day?: string; fromDay?: string; linkText?: string; index?: number }
export interface AssignmentPreview { body: string; membership: string[]; occurrences: Occurrence[]; addedSection: boolean }
function members(membership: unknown): string[] {
  const list: unknown = membership == null || membership === ''
    ? []
    : membership;
  if (!Array.isArray(list) || !list.every(isNoteLink))
    throw new Error('Activity membership must be a note-link list');
  return list;
}
/** The link written for the target, after checking it resolves to exactly that note. */
function canonicalLink(request: AssignmentRequest, resolve: LinkResolver): string {
  const text = request.linkText ?? request.target;
  if (!request.target || /[[\]|#\r\n]/.test(request.target) || /[[\]|#\r\n]/.test(text))
    throw new Error('Choose an unambiguous activity note target');
  const canonical = `[[${text}]]`;
  if (resolve(canonical) !== request.target)
    throw new Error('Activity target is missing or ambiguous');
  return canonical;
}
function nextMembership(list: string[], action: AssignmentAction, canonical: string, match: (link: string) => boolean): string[] {
  if (action === 'full-remove')
    return list.filter(link => !match(link));
  if (action === 'day-remove')
    return [...list];
  // An existing member keeps its place; only later duplicates of it go.
  const kept = list.findIndex(match);
  if (kept < 0)
    return [...list, canonical];
  return list.filter((link, index) => !match(link) || index === kept);
}
/** After the section's last line of content, so the blank line before the next heading stays where it was. */
function appendToEmptyList(output: string, start: number, end: number, bullet: string, newline: string): string {
  const lines = output.slice(start, end).match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const last = lines.reduce((found, line, index) => line.trim()
    ? index
    : found, -1);
  let kept = 0;
  if (last >= 0)
    kept = last + 1;
  else if (lines.length > 0)
    kept = 1;
  const position = start + lines.slice(0, kept).reduce((sum, line) => sum + line.length, 0);
  const before = output.slice(0, position);
  const prefix = position && !before.endsWith('\n')
    ? newline
    : '';
  const followedByText = position < output.length && (last >= 0
    ? lines.length === last + 1
    : lines.length <= 1);
  return `${before}${prefix}${bullet}${newline}${followedByText ? newline : ''}${output.slice(position)}`;
}
/** Writes the bullet into a day that has an activity subsection but doesn't list the target yet. */
function insertBullet(output: string, config: DaySections, day: string, canonical: string, index: number | undefined): string {
  const section = daySections(output, config).find(found => found.date === day);
  if (!section?.activity)
    throw new Error('Missing activity subsection');
  const newline = output.includes('\r\n')
    ? '\r\n'
    : '\n';
  const bullet = `- ${canonical}`;
  const listed = dailyOccurrences(output, config).filter(occurrence => occurrence.date === day);
  const following = index === undefined
    ? undefined
    : listed[index];
  if (following)
    return `${output.slice(0, following.start)}${bullet}${newline}${output.slice(following.start)}`;
  // Last in a list that exists: right after its last bullet, before any notes written under the list.
  const lastListed = listed.at(-1);
  if (!lastListed)
    return appendToEmptyList(output, section.activity.end, section.activityEnd ?? section.end, bullet, newline);
  const lineEnd = output.indexOf('\n', lastListed.start);
  if (lineEnd < 0)
    return `${output}${newline}${bullet}`;
  return output.slice(0, lineEnd + 1) + bullet + newline + output.slice(lineEnd + 1);
}
/** Puts the target on `day` once, adding the day's section if needed; returns the body and whether a section was added. */
function addToDay(body: string, config: DaySections, range: Span, request: AssignmentRequest, canonical: string, match: (link: string) => boolean): { body: string; addedSection: boolean } {
  const day = request.day;
  if (!validSpan(range) || !validDate(day) || day < range.start || day > range.end)
    throw new Error('Choose a day within the entry range');
  const addedSection = !daySections(body, config).find(found => found.date === day)?.activity;
  let output = addedSection
    ? generateDays(body, day, day, { ...config, enabled: true })
    : body;
  const existing = dailyOccurrences(output, config).filter(occurrence => occurrence.date === day && match(occurrence.link));
  // Selected-target deduplication only; preserve every unrelated byte.
  for (const occurrence of existing.slice(1).reverse()) output = output.slice(0, occurrence.start) + output.slice(occurrence.end);
  if (!existing.length)
    output = insertBullet(output, config, day, canonical, request.index);
  return { body: output, addedSection };
}
export function previewAssignment(body: string, membership: unknown, config: DaySections, range: Span, request: AssignmentRequest, resolve: LinkResolver): AssignmentPreview {
  const list = members(membership);
  const canonical = canonicalLink(request, resolve);
  const match = (link: string) => resolve(link) === request.target;
  const nextMembers = nextMembership(list, request.action, canonical, match);
  if (request.action === 'general-add') {
    return {
      body,
      membership: nextMembers,
      occurrences: [],
      addedSection: false,
    };
  }
  const removing = request.action === 'full-remove' || request.action === 'day-remove' || request.action === 'reassign';
  const fromDay = request.action === 'reassign'
    ? request.fromDay
    : request.day;
  const selected = dailyOccurrences(body, config).filter(occurrence => match(occurrence.link) && (request.action === 'full-remove' || occurrence.date === fromDay));
  let output = body;
  if (removing) {
    for (const occurrence of [...selected].reverse()) output = removeLine(output, occurrence.start, occurrence.end);
  }
  if (request.action !== 'day-add' && request.action !== 'reassign') {
    return {
      body: output,
      membership: nextMembers,
      occurrences: selected,
      addedSection: false,
    };
  }
  const added = addToDay(output, config, range, request, canonical, match);
  return {
    body: added.body,
    membership: nextMembers,
    occurrences: selected,
    addedSection: added.addedSection,
  };
}
