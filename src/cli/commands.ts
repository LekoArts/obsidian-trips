import type { CreationIO } from '../creation/create';
import type { BatchIO } from '../editing/batch';
import type { NoteType, PlannerSettings, RecognizedNote } from '../types';
import type { ItineraryDataHost } from '../ui/itinerary/model';
import type { CreateRequest } from './request';
import { noteName } from '../config/paths';
import { tripContents, validateProfile } from '../config/profile';
import { parseProperties, splitNote } from '../config/template-render';
import { filled, validateName, validDate } from '../config/validation';
import { applyCreation, previewCreation } from '../creation/create';
import { buildDraft } from '../creation/draft';
import { linkTarget } from '../discovery';
import { attentionItems } from '../discovery/attention';
import { linkResolver, tripLayout } from '../ui/itinerary/layout';
import { loadItinerary, tripPaths } from '../ui/itinerary/model';
import { CliError } from './reply';
import { fieldStrings } from './request';

export interface CliIO extends CreationIO, BatchIO { paths: () => string[]; headings: (path: string, level: number) => string[] }
/** What the commands need from the plugin. Getters, because saving settings or rebuilding the index replaces them. */
export interface CliContext {
  io: CliIO;
  settings: () => PlannerSettings;
  index: () => RecognizedNote[];
  /** Each note's frontmatter, as the metadata cache has it. */
  properties: () => Map<string, Record<string, unknown>>;
  /** The text of every configured template that could be read. */
  templates: Map<string, string>;
  /** The link text Obsidian would write for `path` in a note at `from`. */
  linkText: (path: string, from: string) => string;
  rememberCreated: (notes: { path: string; typeId: string }[]) => Promise<void>;
  /** Rebuilds the index from the metadata cache. */
  refresh: () => void;
  wait: (ms: number) => Promise<void>;
}

const ATTENTION_HELP = 'Resolve these in Obsidian with the command "Review notes that need attention".';
// A note created a moment ago reaches the index only once Obsidian's metadata cache has read it.
const RETRIES = 8;
const RETRY_PAUSE = 250;

export function dataHost(ctx: CliContext): ItineraryDataHost {
  return {
    get settings() { return ctx.settings(); },
    get index() { return ctx.index(); },
    io: ctx.io,
  };
}

/** Looks again after refreshing the index until `find` has a result or about two seconds have passed. */
async function settled<T>(ctx: CliContext, find: () => T | undefined): Promise<T | undefined> {
  for (let attempt = 0; ; attempt++) {
    const found = find();
    if (found !== undefined || attempt === RETRIES)
      return found;
    await ctx.wait(RETRY_PAUSE);
    ctx.refresh();
  }
}

export function setUpTypes(ctx: CliContext): NoteType[] {
  const profile = ctx.settings().profile;
  if (!profile.types.length)
    throw new CliError('NOT_SET_UP', 'Trips is not set up in this vault. Ask the user to set it up in Obsidian under Settings → Trips.');
  const problems = validateProfile(profile, {
    exists: path => ctx.io.exists(path),
    template: path => ctx.templates.get(path),
  });
  if (problems.length)
    throw new CliError('NOT_SET_UP', `The Trips setup has problems the user must fix in Settings → Trips: ${problems.map(problem => problem.message).join('; ')}`);
  return profile.types;
}

const recognized = (note: RecognizedNote) => filled(note.typeId) && !note.diagnostics.some(d => d.capability === 'recognition');
const matches = (path: string, wanted: string) => path === wanted || path === `${wanted}.md` || noteName(path) === wanted;

/** A recognized trip by path or by note name, if only one trip has that name. */
export async function findTrip(ctx: CliContext, wanted: string): Promise<string> {
  const found = await settled(ctx, () => {
    const paths = tripPaths(dataHost(ctx)).filter(path => matches(path, wanted));
    return paths.length ? paths : undefined;
  });
  if (!found)
    throw new CliError('PARENT_NOT_FOUND', `No trip named ${wanted}. Check the trip paths in trips:list; if it was just created, retry in a moment.`);
  if (found.length > 1)
    throw new CliError('PARENT_AMBIGUOUS', `Several trips are named ${wanted}; pass one of these paths: ${found.join(', ')}`);
  return found[0]!;
}

/** An activity, or a day plan/stop (`entry`), of the trip by path or by note name, if only one has that name. */
export async function findChild(ctx: CliContext, tripPath: string, role: 'activity' | 'entry', wanted: string): Promise<string> {
  const types = ctx.settings().profile.types;
  const found = await settled(ctx, () => {
    const paths = ctx.index().filter(note => recognized(note) && note.parentPath === tripPath && types.find(type => type.id === note.typeId)?.role === role && matches(note.path, wanted)).map(note => note.path);
    return paths.length ? paths : undefined;
  });
  if (role === 'activity') {
    if (!found)
      throw new CliError('ACTIVITY_NOT_FOUND', `${noteName(tripPath)} has no activity named ${wanted}. Create it with trips:create first; if it was just created, retry in a moment.`);
    if (found.length > 1)
      throw new CliError('ACTIVITY_AMBIGUOUS', `Several activities of ${noteName(tripPath)} are named ${wanted}; pass one of these paths: ${found.join(', ')}`);
  }
  if (!found)
    throw new CliError('NOTE_NOT_FOUND', `${noteName(tripPath)} has no day plan or stop named ${wanted}. Check the entries in trips:list; if it was just created, retry in a moment.`);
  if (found.length > 1)
    throw new CliError('NOTE_AMBIGUOUS', `Several day plans or stops of ${noteName(tripPath)} are named ${wanted}; pass one of these paths: ${found.join(', ')}`);
  return found[0]!;
}

function propertiesOf(ctx: CliContext, content: string): Record<string, unknown> {
  return parseProperties(splitNote(content).yaml, ctx.io.codec);
}

function attention(ctx: CliContext, types: NoteType[]) {
  return attentionItems(ctx.index(), types, ctx.properties());
}

export function status(ctx: CliContext) {
  const types = setUpTypes(ctx);
  return {
    kinds: types.length,
    folders: ctx.settings().profile.scopes,
    trips: tripPaths(dataHost(ctx)).length,
    attention: attention(ctx, types),
    attentionHelp: ATTENTION_HELP,
  };
}

export function kinds(ctx: CliContext) {
  const types = setUpTypes(ctx);
  return {
    kinds: types.map((type) => {
      const template = ctx.templates.get(type.template);
      const missing = filled(type.template) && template === undefined;
      return {
        id: type.id,
        label: type.label,
        role: type.role,
        dated: type.dated,
        daySections: type.days.enabled,
        ...(type.role === 'trip'
          ? {
              contains: tripContents(type, types, template ?? '').map(kind => kind.id),
            }
          : {}),
        ...(missing
          ? { templateMissing: true }
          : {}),
        fields: type.fields.map(field => ({
          key: field.key,
          label: field.label,
          type: field.type,
          required: field.required,
          default: field.defaultValue ?? null,
        })),
      };
    }),
  };
}

export async function list(ctx: CliContext) {
  const types = setUpTypes(ctx);
  const host = dataHost(ctx);
  const paths = ctx.io.paths();
  const trips = [];
  for (const tripPath of tripPaths(host).sort()) {
    try {
      const model = await loadItinerary(host, tripPath);
      const layout = tripLayout(model, paths);
      const entries = layout.entries.map((row) => {
        const resolve = linkResolver(paths, row.note.snapshot.path);
        const members: unknown = row.note.properties[row.note.type.mappings.activities];
        return {
          path: row.note.snapshot.path,
          name: row.name,
          kind: row.note.type.id,
          start: row.note.start,
          end: row.note.end,
          activities: (Array.isArray(members)
            ? members
            : []).filter(link => typeof link === 'string').map((link: string) => noteName(resolve(link) ?? linkTarget(link))),
          days: row.days.filter(day => day.activities.length).map(day => ({
            date: day.date,
            activities: day.activities.map(activity => activity.name),
          })),
          ...(row.outside.length
            ? {
                outsideDates: row.outside.map(activity => ({ date: activity.date, activity: activity.name })),
              }
            : {}),
        };
      });
      trips.push({
        path: tripPath,
        name: noteName(tripPath),
        kind: model.trip.type.id,
        start: model.trip.start,
        end: model.trip.end,
        entries,
        activities: [...model.activities].sort((a, b) => noteName(a.snapshot.path).localeCompare(noteName(b.snapshot.path)) || a.snapshot.path.localeCompare(b.snapshot.path)).map(note => ({
          path: note.snapshot.path,
          name: noteName(note.snapshot.path),
          kind: note.type.id,
          days: layout.entries.flatMap(row => row.days.flatMap(day => day.activities.filter(activity => activity.path === note.snapshot.path).map(() => ({ entry: row.name, date: day.date })))),
        })),
      });
    }
    catch (error) {
      trips.push({
        path: tripPath,
        name: noteName(tripPath),
        error: String(error).replace(/^Error:\s*/, ''),
      });
    }
  }
  return {
    trips,
    attention: attention(ctx, types),
    attentionHelp: ATTENTION_HELP,
  };
}

function checkDates(type: NoteType, start: string | undefined, end: string | undefined): void {
  for (const date of [start, end]) {
    if (date !== undefined && !validDate(date))
      throw new CliError('DATES_INVALID', `${String(date)} is not a valid YYYY-MM-DD date`);
  }
  if ((type.dated || type.days.enabled) && (start === undefined || end === undefined))
    throw new CliError('DATES_INVALID', `A ${type.label} needs start and end dates`);
  if ((start === undefined) !== (end === undefined))
    throw new CliError('DATES_INVALID', 'Pass both start and end, or neither');
  if (start !== undefined && end !== undefined && end < start)
    throw new CliError('DATES_INVALID', 'The end date is before the start date');
}

/** The trip a child goes in, refusing kinds the trip doesn't hold and dates outside it. */
async function parentTrip(ctx: CliContext, types: NoteType[], type: NoteType, request: CreateRequest): Promise<string | undefined> {
  if (type.role === 'trip') {
    if (filled(request.trip))
      throw new CliError('INVALID_INPUT', `A ${type.label} trip has no parent trip; leave out trip`);
    return undefined;
  }
  if (!filled(request.trip))
    throw new CliError('INVALID_INPUT', `trip is required for a ${type.label}`);
  const tripPath = await findTrip(ctx, request.trip);
  const tripType = types.find(item => item.id === ctx.index().find(note => note.path === tripPath)?.typeId);
  if (!tripType)
    throw new CliError('PARENT_NOT_FOUND', `${tripPath} is not a recognized trip`);
  const content = await ctx.io.read(tripPath);
  const holds = tripContents(tripType, types, content, ctx.templates.get(tripType.template) ?? '');
  if (!holds.includes(type))
    throw new CliError('UNKNOWN_KIND', `${tripType.label} trips hold ${holds.map(kind => kind.id).join(', ') || 'no other notes'}, not ${type.id}`);
  const properties = propertiesOf(ctx, content);
  const first = properties[tripType.mappings.start];
  const last = properties[tripType.mappings.end];
  if (filled(request.start) && filled(request.end) && validDate(first) && validDate(last) && (request.start < first || request.end > last))
    throw new CliError('DATES_INVALID', `Dates must be within the trip (${first} to ${last}); widen the trip with trips:reschedule first if the user wants that`);
  return tripPath;
}

async function draftActivities(ctx: CliContext, type: NoteType, request: CreateRequest, tripPath: string | undefined) {
  if (!request.activities.length)
    return undefined;
  if (type.role !== 'entry' || !filled(tripPath))
    throw new CliError('INVALID_INPUT', `A ${type.label} can't list activities`);
  const result = [];
  const chosen = new Set<string>();
  for (const activity of request.activities) {
    if (filled(activity.day)) {
      if (!type.days.enabled)
        throw new CliError('INVALID_INPUT', `A ${type.label} has no day sections; leave out day`);
      if (!validDate(activity.day) || activity.day < (request.start ?? '') || activity.day > (request.end ?? ''))
        throw new CliError('DATES_INVALID', `${activity.day} must be a YYYY-MM-DD day from ${request.start ?? '?'} to ${request.end ?? '?'}`);
    }
    const path = await findChild(ctx, tripPath, 'activity', activity.name);
    // The form offers each activity once; listing one twice would repeat it in the entry's Activities property.
    if (chosen.has(path))
      throw new CliError('INVALID_INPUT', `${path} is listed more than once in activities; list each activity once`);
    chosen.add(path);
    result.push({
      link: ctx.linkText(path, tripPath),
      day: activity.day,
    });
  }
  return result;
}

function creationError(error: unknown): CliError {
  const message = String(error).replace(/^Error:\s*/, '');
  if (message.startsWith('Destination exists'))
    return new CliError('DESTINATION_EXISTS', `${message}. Use a different name, or work with the existing note.`);
  if (message.startsWith('File changed') || message.startsWith('An open editor'))
    return new CliError('WRITE_FAILED', message, { completed: [], untouched: [] });
  if (/dates/i.test(message))
    return new CliError('DATES_INVALID', message);
  return new CliError('INVALID_INPUT', message);
}

/** One note, built and written exactly as the creation form would. */
export async function create(ctx: CliContext, request: CreateRequest) {
  const types = setUpTypes(ctx);
  const profile = JSON.stringify(ctx.settings().profile);
  const type = types.find(item => item.id === request.kind);
  if (!type)
    throw new CliError('UNKNOWN_KIND', `Unknown kind ${request.kind}; use one of ${types.map(item => item.id).join(', ')} (see trips:kinds)`);
  const nameProblems = validateName(request.name);
  if (nameProblems.length)
    throw new CliError('INVALID_INPUT', nameProblems.join('; '));
  checkDates(type, request.start, request.end);
  const fields = fieldStrings(type.fields, request.fields);
  const parentPath = await parentTrip(ctx, types, type, request);
  const activities = await draftActivities(ctx, type, request, parentPath);
  let plan;
  try {
    const draft = await buildDraft({
      type,
      name: request.name,
      start: request.start,
      end: request.end,
      fields,
      parentPath,
      activities,
    }, {
      io: ctx.io,
      index: ctx.index(),
      types,
      linkText: ctx.linkText,
    });
    plan = await previewCreation(ctx.io, [draft]);
  }
  catch (error) { throw creationError(error); }
  // As the form does: a note planned with kinds that have since changed would come out in the old format.
  if (JSON.stringify(ctx.settings().profile) !== profile)
    throw new CliError('CHANGED', 'The Trips setup changed while the note was being prepared; nothing was written. Check trips:kinds and retry.');
  const report = await applyCreation(ctx.io, plan);
  if (filled(report.failed)) {
    throw new CliError('WRITE_FAILED', `${String(report.error).replace(/^Error:\s*/, '')}. ${report.failed} may exist partly written; check it before retrying.`, {
      completed: report.completed,
      failed: report.failed,
      untouched: report.untouched,
    });
  }
  const created = report.completed[0] ?? null;
  try {
    await ctx.rememberCreated(report.completed.map(path => ({ path, typeId: type.id })));
  }
  catch (error) {
    return { created, untouched: report.untouched, warning: `The note was written, but its kind could not be remembered: ${String(error)}. Don't create it again.` };
  }
  return { created, untouched: report.untouched };
}
