import type { BatchPlan } from '../editing/batch';
import type { EntryRow } from '../ui/itinerary/layout';
import type { ItineraryModel } from '../ui/itinerary/model';
import type { CliContext } from './commands';
import type { AssignRequest, RescheduleRequest } from './request';
import { noteName } from '../config/paths';
import { filled } from '../config/validation';
import { validSpan } from '../travel/schedule';
import { linkResolver, tripLayout } from '../ui/itinerary/layout';
import { loadItinerary } from '../ui/itinerary/model';
import { applyPlan, assignmentPlan, extensionPlan, movePlan, OutsideTrip, spanPlan } from '../ui/itinerary/operations';
import { dataHost, findChild, findTrip, setUpTypes } from './commands';
import { CliError } from './reply';

const message = (error: unknown) => String(error).replace(/^Error:\s*/, '');
const changed = (why: string) => new CliError('CHANGED', `${why}; nothing was written. Reload with trips:list and retry.`);

/** The trip as the trip tab would load it, refusing when the settings changed while it was read. */
async function load(ctx: CliContext, tripPath: string): Promise<ItineraryModel> {
  const settings = JSON.stringify(ctx.settings());
  let model;
  try {
    model = await loadItinerary(dataHost(ctx), tripPath);
  }
  catch (error) {
    if (message(error).startsWith('Trip disappeared'))
      throw changed(message(error));
    throw error;
  }
  // loadItinerary reads settings across several awaits and records them only at the end.
  if (model.profile !== settings)
    throw changed('The Trips settings changed while the trip was read');
  return model;
}

function row(ctx: CliContext, model: ItineraryModel, path: string): EntryRow {
  const found = tripLayout(model, ctx.io.paths()).entries.find(entry => entry.note.snapshot.path === path);
  if (!found)
    throw changed(`${path} is no longer part of the trip`);
  return found;
}

/** Whether `path` is listed on `date` in the entry, including days outside its current dates. */
function onDay(entry: EntryRow, path: string, date: string): boolean {
  return [
    ...entry.days.filter(day => day.date === date).flatMap(day => day.activities),
    ...entry.outside.filter(activity => activity.date === date),
  ].some(activity => activity.path === path);
}

function isMember(ctx: CliContext, entry: EntryRow, path: string): boolean {
  const members: unknown = entry.note.properties[entry.note.type.mappings.activities];
  const resolve = linkResolver(ctx.io.paths(), entry.note.snapshot.path);
  return entry.note.daily.some(occurrence => resolve(occurrence.link) === path)
    || (Array.isArray(members) && members.some(link => typeof link === 'string' && resolve(link) === path));
}

/** The trip tab only lets activities onto days that are inside both the entry and the trip. */
function checkPlacement(model: ItineraryModel, entry: EntryRow, day: string): void {
  const note = entry.note;
  if (!validSpan(note) || !validSpan(model.trip))
    throw new CliError('DAY_OUTSIDE_ENTRY', `${entry.name} or its trip has no valid dates; fix them with trips:reschedule first`);
  const start = note.start > model.trip.start
    ? note.start
    : model.trip.start;
  const end = note.end < model.trip.end
    ? note.end
    : model.trip.end;
  if (day < start || day > end) {
    throw new CliError('DAY_OUTSIDE_ENTRY', `${day} is outside ${entry.name}${start === note.start && end === note.end
      ? ''
      : ' within the trip'}; choose a day from ${start} to ${end}`);
  }
}

/** Builds the change the way the trip tab does; refusals from the note itself (unclosed comment, duplicate headings…) can't be fixed here. */
function build(make: () => BatchPlan): BatchPlan {
  try {
    return make();
  }
  catch (error) {
    if (error instanceof CliError)
      throw error;
    throw new CliError('CANNOT_EDIT', `${message(error)}. Fix the note in Obsidian first.`);
  }
}

async function apply(ctx: CliContext, model: ItineraryModel, plan: BatchPlan) {
  let report;
  try {
    report = await applyPlan(dataHost(ctx), model, plan);
  }
  catch (error) { throw changed(message(error).replace(/;.*$/, '')); }
  if (filled(report.failed)) {
    throw new CliError('WRITE_FAILED', `${message(report.error)}. Files in completed were written; check them with trips:list before retrying.`, {
      completed: report.completed,
      failed: report.failed,
      untouched: report.untouched,
    });
  }
  return {
    completed: report.completed,
    summary: plan.steps.map(step => step.summary).join(' '),
  };
}

interface Target { ctx: CliContext; model: ItineraryModel; activity: string; to: EntryRow }

function removal({ ctx, model, activity, to }: Target, day: string | undefined): BatchPlan {
  const on = filled(day)
    ? `on ${day} in`
    : 'in';
  if (filled(day)
    ? !onDay(to, activity, day)
    : !isMember(ctx, to, activity)) {
    throw new CliError('NOT_ON_DAY', `${noteName(activity)} is not ${on} ${to.name}; see trips:list`);
  }
  return build(() => assignmentPlan(dataHost(ctx), model, to.note, filled(day)
    ? { action: 'day-remove', target: activity, day }
    : { action: 'full-remove', target: activity }));
}

function placement({ ctx, model, activity, to }: Target, request: AssignRequest, fromPath: string): BatchPlan {
  let from: { row: EntryRow; date: string } | undefined;
  if (request.action === 'move') {
    const source = row(ctx, model, fromPath);
    const fromDay = request.fromDay!;
    if (!onDay(source, activity, fromDay))
      throw new CliError('NOT_ON_DAY', `${noteName(activity)} is not on ${fromDay} in ${source.name}; see trips:list`);
    from = { row: source, date: fromDay };
  }
  const day = request.day!;
  checkPlacement(model, to, day);
  const index = request.position === undefined
    ? undefined
    : request.position - 1;
  return build(() => movePlan(dataHost(ctx), model, activity, to, day, from, index));
}

/** Puts an existing activity on a day, moves it, or takes it off: the same changes as dragging it in the trip tab. */
export async function assign(ctx: CliContext, request: AssignRequest) {
  setUpTypes(ctx);
  const tripPath = await findTrip(ctx, request.trip);
  const activity = await findChild(ctx, tripPath, 'activity', request.activity);
  const entryPath = await findChild(ctx, tripPath, 'entry', request.entry);
  const fromPath = filled(request.fromEntry)
    ? await findChild(ctx, tripPath, 'entry', request.fromEntry)
    : entryPath;
  const model = await load(ctx, tripPath);
  if (!model.activities.some(note => note.snapshot.path === activity))
    throw changed(`${activity} is no longer an activity of the trip`);
  const target = {
    ctx,
    model,
    activity,
    to: row(ctx, model, entryPath),
  };
  const plan = request.action === 'remove'
    ? removal(target, request.day)
    : placement(target, request, fromPath);
  return apply(ctx, model, plan);
}

/** New dates for a day plan or stop (growing the trip with `extend`), or wider dates for the trip itself. */
export async function reschedule(ctx: CliContext, request: RescheduleRequest) {
  setUpTypes(ctx);
  if (request.end < request.start)
    throw new CliError('DATES_INVALID', 'The end date is before the start date');
  const tripPath = await findTrip(ctx, request.trip);
  const entryPath = filled(request.entry)
    ? await findChild(ctx, tripPath, 'entry', request.entry)
    : undefined;
  const model = await load(ctx, tripPath);
  let plan: BatchPlan;
  try {
    if (filled(entryPath)) {
      const note = row(ctx, model, entryPath).note;
      plan = spanPlan(model, note, { start: request.start, end: request.end }, request.extend);
    }
    else {
      plan = extensionPlan(model, request.start, request.end);
    }
  }
  catch (error) {
    if (error instanceof CliError)
      throw error;
    if (error instanceof OutsideTrip)
      throw new CliError('OUTSIDE_TRIP', `The trip would have to run from ${error.range.start} to ${error.range.end}. Pass extend to grow the trip, but only if the user wants that.`);
    throw new CliError('DATES_INVALID', `${message(error)}.`);
  }
  return apply(ctx, model, plan);
}
