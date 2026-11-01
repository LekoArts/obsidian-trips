import type { Occurrence } from '../../travel/assignments';
import type { DayFormatMismatch } from '../../travel/day-sections';
import type { Span } from '../../travel/schedule';
import type { ItineraryModel, ItineraryNote } from './model';
import { getLanguage } from 'obsidian';
import { noteName } from '../../config/paths';
import { filled } from '../../config/validation';
import { linkTarget, resolveTargets } from '../../discovery';
import { addDays, inclusiveDays } from '../../travel/dates';
import { dayFormatMismatch } from '../../travel/day-sections';
import { validSpan } from '../../travel/schedule';
import { formatFix } from '../day-format';

/** Every note a link could mean: the one beside the linking note if there is one, else every match in the vault. */
export function linkMatches(paths: string[], from: string, link: string): string[] {
  const target = linkTarget(link);
  const local = `${from.slice(0, from.lastIndexOf('/') + 1)}${target}`;
  const nearby = paths.filter(path => path === local || path === `${local}.md`);
  return nearby.length
    ? nearby
    : resolveTargets(link, paths);
}
export function linkResolver(paths: string[], from: string): (link: string) => string | undefined {
  return (link) => {
    const matches = linkMatches(paths, from, link);
    return matches.length === 1
      ? matches[0]
      : undefined;
  };
}
/** `matches`: how many notes the link could mean when it isn't exactly one (0 = no such note). */
export interface DayActivity { link: string; name: string; path?: string; matches?: number }
export interface DayRow { date: string; activities: DayActivity[] }
export interface EntryRow {
  note: ItineraryNote;
  name: string;
  valid: boolean;
  days: DayRow[];
  outside: (DayActivity & { date: string })[];
  warnings: string[];
}
/**
 * Notes of one kind whose day headings are in another date format, reported once for the kind since one setting fixes
 * them all. `lead` and `fix` go before and after the linked note names.
 */
export interface FormatProblem { kindId: string; kind: string; lead: string; notes: { name: string; path: string }[]; fix: string }
export interface TripLayout { entries: EntryRow[]; unplanned: ItineraryNote[]; attention: { name: string; path: string; message: string }[]; formats: FormatProblem[] }

function formatProblems(notes: ItineraryNote[], verdicts: Record<string, DayFormatMismatch>): FormatProblem[] {
  const groups = new Map<string, { note: ItineraryNote; example: string }[]>();
  for (const note of notes) {
    const own = dayFormatMismatch(note.dayHeadings, note.type.days.dateFormat);
    if (own) {
      groups.set(note.type.id, [
        ...groups.get(note.type.id) ?? [],
        { note, example: own.example },
      ]);
    }
  }
  // The fix comes from the kind's verdict across the vault, so it matches settings; the example from this trip.
  return [
    ...groups.values(),
  ].flatMap((group) => {
    const type = group[0]!.note.type;
    const mismatch = verdicts[type.id];
    return mismatch
      ? [
          {
            kindId: type.id,
            kind: type.label,
            lead: `day headings like ${group[0]!.example} aren’t read as days in`,
            notes: group.map(({ note }) => ({
              name: noteName(note.snapshot.path),
              path: note.snapshot.path,
            })),
            fix: formatFix(mismatch, type.days.dateFormat),
          },
        ]
      : [];
  });
}

/** Day and month names in Obsidian's language. */
function dates(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(getLanguage(), { ...options, timeZone: 'UTC' });
}
const instant = (date: string): Date => new Date(`${date}T00:00:00Z`);
export function dayLabel(date: string): string {
  return dates({ weekday: 'short', day: 'numeric', month: 'short' }).format(instant(date));
}
export function rangeLabel(start: string, end: string): string {
  if (!validSpan({ start, end })) {
    return start || end
      ? `${start || '?'} – ${end || '?'}`
      : 'No dates';
  }
  const format = dates({
    day: 'numeric',
    month: 'short',
    ...(start.slice(0, 4) === end.slice(0, 4)
      ? {}
      : { year: 'numeric' }),
  });
  return format.formatRange(instant(start), instant(end));
}

function entryWarnings(note: ItineraryNote, trip: ItineraryNote, tripValid: boolean): string[] {
  if (note.type.dated && !validSpan(note)) {
    if (!note.start || !note.end)
      return ['Start or end date is missing'];
    return [
      note.start > note.end
        ? 'End date is before start date'
        : 'Dates are not valid YYYY-MM-DD dates',
    ];
  }
  if (validSpan(note) && tripValid && (note.start < trip.start || note.end > trip.end))
    return [`Outside the trip's dates (${rangeLabel(trip.start, trip.end)})`];
  return [];
}
function startKey(note: ItineraryNote) {
  return validSpan(note)
    ? note.start
    : '\uFFFF';
}
export function tripLayout(model: ItineraryModel, paths: string[]): TripLayout {
  const planned = new Set<string>();
  const toActivity = (note: ItineraryNote, occurrence: Occurrence): DayActivity => {
    const matches = linkMatches(paths, note.snapshot.path, occurrence.link);
    const path = matches.length === 1
      ? matches[0]
      : undefined;
    if (filled(path)) {
      planned.add(path);
      return {
        link: occurrence.link,
        path,
        name: noteName(path),
      };
    }
    return {
      link: occurrence.link,
      name: noteName(linkTarget(occurrence.link)),
      matches: matches.length,
    };
  };
  const sorted = [...model.entries].sort((a, b) => startKey(a).localeCompare(startKey(b)) || a.snapshot.path.localeCompare(b.snapshot.path));
  const tripValid = validSpan(model.trip);
  const entries: EntryRow[] = [];
  for (const note of sorted) {
    const valid = validSpan(note);
    const warnings = [
      ...note.diagnostics,
      ...entryWarnings(note, model.trip, tripValid),
    ];
    const days: DayRow[] = valid
      ? inclusiveDays(note.start, note.end).map(date => ({ date, activities: [] }))
      : [];
    const outside: EntryRow['outside'] = [];
    for (const occurrence of note.daily) {
      const activity = toActivity(note, occurrence);
      const day = days.find(day => day.date === occurrence.date);
      if (day)
        day.activities.push(activity); else
        outside.push({ ...activity, date: occurrence.date });
    }
    entries.push({
      note,
      name: noteName(note.snapshot.path),
      valid,
      days,
      outside,
      warnings,
    });
  }
  const attention = [
    model.trip,
    ...entries.map(row => row.note),
    ...model.activities,
    ...model.detached,
  ].flatMap((note) => {
    const row = entries.find(row => row.note === note);
    const messages = row ? row.warnings : note.diagnostics;
    return messages.map(message => ({
      name: noteName(note.snapshot.path),
      path: note.snapshot.path,
      message,
    }));
  });
  if (!tripValid) {
    attention.unshift({
      name: noteName(model.trip.snapshot.path),
      path: model.trip.snapshot.path,
      message: 'Set valid trip start and end dates to plan days and move entries',
    });
  }
  return {
    entries,
    unplanned: model.activities.filter(note => !planned.has(note.snapshot.path)),
    attention,
    formats: formatProblems(sorted, model.dayFormats),
  };
}
/** Tones cycle in start order, so consecutive and overlapping entries never share one. */
export const TONES = 6;
/**
 * One entry on one day. `tone` colours the entry the same on every day it covers; `first` and `last`
 * are its own first and last day, which tells a changeover from a real overlap.
 * `head`: the entry's first day in the trip, where its name and controls go (its own first day, unless it starts before the trip).
 */
export interface DaySlot { row: EntryRow; tone: number; first: boolean; last: boolean; head: boolean; activities: DayActivity[] }
export interface TripDay {
  /** `slots`: the entries covering this day, in start order (on a changeover day the one ending comes first). */
  date: string;
  slots: DaySlot[];
  /** Daily links written for this day in an entry that no longer covers it (left where they are). */
  stray: { row: EntryRow; activity: DayActivity }[];
  /** Set when two entries share more than a changeover day. */
  overlap?: string;
}
/** `beyond`: daily links written for dates outside the trip, which no day row can show. */
export interface TripPlan { days: TripDay[]; beyond: { row: EntryRow; date: string; activity: DayActivity }[] }
/** The trip as days, the shape every edit in the trip tab works on. Empty when the trip has no valid dates. */
export function tripDays(layout: TripLayout, trip: Span): TripPlan {
  if (!validSpan(trip))
    return { days: [], beyond: [] };
  const rows = layout.entries.filter(row => row.valid && row.note.end >= trip.start && row.note.start <= trip.end)
    .sort((a, b) => a.note.start.localeCompare(b.note.start) || a.note.end.localeCompare(b.note.end));
  const days = inclusiveDays(trip.start, trip.end).map((date): TripDay => {
    const slots = rows.flatMap((row, index) => row.note.start <= date && date <= row.note.end
      ? [
          {
            row,
            tone: index % TONES,
            first: row.note.start === date,
            last: row.note.end === date,
            head: date === (row.note.start < trip.start
              ? trip.start
              : row.note.start),
            activities: row.days.find(day => day.date === date)?.activities ?? [],
          },
        ]
      : []);
    const stray = layout.entries.flatMap(row => row.outside.filter(item => item.date === date).map(activity => ({ row, activity })));
    const clash = slots.flatMap((a, i) => slots.slice(i + 1).filter(b => !((a.last && b.first) || (b.last && a.first))).map(b => `${a.row.name} and ${b.row.name} overlap`));
    return {
      date,
      slots,
      stray,
      overlap: clash.length
        ? clash.join('; ')
        : undefined,
    };
  });
  const beyond = layout.entries.flatMap(row => [
    ...row.days.flatMap(day => day.activities.map(activity => ({ row, date: day.date, activity }))),
    ...row.outside.map(item => ({ row, date: item.date, activity: item })),
  ])
    .filter(item => item.date < trip.start || item.date > trip.end)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { days, beyond };
}
/**
 * Dates for a new entry started on a free day: it runs to the end of the free stretch and, when another
 * entry follows, through that entry's first day, since consecutive stays share their changeover day.
 */
export function freeStretch(plan: TripPlan, date: string): Span {
  let end = date;
  for (const day of plan.days) {
    if (day.date <= date)
      continue;
    if (day.slots.length)
      return { start: date, end: day.date };
    end = day.date;
  }
  return { start: date, end };
}
/** The day `step` days away within the same entry, or undefined at its first or last day. */
export function neighbourDay(row: EntryRow, date: string, step: number): string | undefined {
  const index = row.days.findIndex(day => day.date === date);
  return index < 0
    ? undefined
    : row.days[index + step]?.date;
}
/**
 * Where Alt+Up/Down sends an activity: one place up or down within its day, else onto the neighbouring day
 * (in this entry if it covers that day, else the first entry on it), or refused at the edge of the trip.
 */
export type Step = { date: string; row: EntryRow; index?: number } | { refused: string };
export function stepTarget(plan: TripPlan, row: EntryRow, date: string, position: number, step: -1 | 1): Step {
  const count = plan.days.find(day => day.date === date)?.slots.find(slot => slot.row.note === row.note)?.activities.length ?? 0;
  if (position >= 0 && position + step >= 0 && position + step < count)
    return { date, row, index: position + step };
  const index = step > 0
    ? 0
    : undefined;
  const own = neighbourDay(row, date, step);
  if (filled(own))
    return { date: own, row, index };
  const here = plan.days.findIndex(day => day.date === date);
  const next = here < 0
    ? undefined
    : plan.days[here + step];
  if (!next) {
    return {
      refused: here < 0
        ? 'This day is outside the trip. Drag or use the menu to put it on a trip day.'
        : `${step > 0
          ? 'The trip ends'
          : 'The trip starts'} here. Change the trip dates to plan beyond it.`,
    };
  }
  const other = next.slots[0];
  return other
    ? { date: next.date, row: other.row, index }
    : { refused: `Nothing is planned on ${dayLabel(next.date)} to move it into.` };
}
export function shiftSpan(span: Span, days: number): Span {
  return {
    start: addDays(span.start, days),
    end: addDays(span.end, days),
  };
}
