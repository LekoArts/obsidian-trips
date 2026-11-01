import type { BatchPlan, BatchReport, BatchStep } from '../../editing/batch';
import type { AssignmentRequest } from '../../travel/assignments';
import type { Span } from '../../travel/schedule';
import type { EntryRow } from './layout';
import type { ItineraryDataHost, ItineraryModel, ItineraryNote } from './model';
import { noteName } from '../../config/paths';
import { splitNote } from '../../config/template-render';
import { filled } from '../../config/validation';
import { applyBatch, batchPlan } from '../../editing/batch';
import { previewAssignment } from '../../travel/assignments';
import { relationshipPreview, trashPreview } from '../../travel/remove';
import { setSpan, validSpan } from '../../travel/schedule';
import { dayLabel, linkResolver, rangeLabel } from './layout';

/** A date change that would leave the trip; the fix (extending the trip) is offered next to it. */
export class OutsideTrip extends Error {
  constructor(readonly range: Span) {
    super(`That would end up outside the trip (${rangeLabel(range.start, range.end)} needed).`);
  }
}
/** One entry gets new dates (moved or made longer/shorter). With `extend`, the trip grows to fit in the same change. */
export function spanPlan(model: ItineraryModel, note: ItineraryNote, next: Span, extend = false): BatchPlan {
  const result = setSpan(model.trip, note, next);
  if (result.outside && !extend)
    throw new OutsideTrip(result.outside);
  const stranded = note.daily.filter(occurrence => occurrence.date < next.start || occurrence.date > next.end).length;
  const steps: BatchStep[] = [];
  if (result.outside) {
    steps.push({
      before: model.trip.snapshot,
      kind: 'properties',
      changes: { [model.trip.type.mappings.start]: result.outside.start, [model.trip.type.mappings.end]: result.outside.end },
      summary: `Trip now ${rangeLabel(result.outside.start, result.outside.end)}.`,
    });
  }
  steps.push({
    before: note.snapshot,
    kind: 'properties',
    changes: { [note.type.mappings.start]: next.start, [note.type.mappings.end]: next.end },
    summary: `${noteName(note.snapshot.path)} now ${rangeLabel(next.start, next.end)}. Dates written inside the note weren't changed.${stranded
      ? ` ${stranded} ${stranded === 1
        ? 'activity is'
        : 'activities are'} on days outside it now.`
      : ''}`,
  });
  return batchPlan(steps, result.outside
    ? []
    : [model.trip.snapshot]);
}
export function extensionPlan(model: ItineraryModel, start: string, end: string): BatchPlan {
  if (!validSpan({ start, end }))
    throw new Error('Enter valid ordered trip dates');
  if (validSpan(model.trip) && (start > model.trip.start || end < model.trip.end))
    throw new Error('Extend the trip without narrowing its existing range');
  return batchPlan([
    {
      before: model.trip.snapshot,
      kind: 'properties',
      changes: { [model.trip.type.mappings.start]: start, [model.trip.type.mappings.end]: end },
      summary: `Trip dates ${rangeLabel(model.trip.start, model.trip.end)} → ${rangeLabel(start, end)}. Entries keep their dates.`,
    },
  ]);
}
function assignmentSummary(note: ItineraryNote, request: AssignmentRequest, addedSection: boolean): string {
  const name = noteName(request.target);
  const where = noteName(note.snapshot.path);
  const day = filled(request.day)
    ? dayLabel(request.day)
    : '';
  const added = addedSection
    ? ` Added a ${day} → ${note.type.days.activityHeading} section to ${where}.`
    : '';
  switch (request.action) {
    case 'full-remove': return `Removed ${name} from ${where}. The activity note stays.`;
    case 'day-remove': return `Took ${name} off ${day}.`;
    case 'reassign': return request.fromDay === request.day
      ? `Reordered ${day}.`
      : `Moved ${name} to ${day}.${added}`;
    case 'day-add': return `Put ${name} on ${day}.${added}`;
    case 'general-add': return `Added ${name} to ${where}.`;
  }
}
/** The note's frontmatter as it stays, or rewritten when the activity list changes along with the body. */
function frontmatter(host: ItineraryDataHost, note: ItineraryNote, changes: Record<string, unknown>, membership: string[]): string {
  const content = note.snapshot.content;
  if (JSON.stringify(note.properties[note.type.mappings.activities] ?? []) === JSON.stringify(membership))
    return content.slice(0, content.length - splitNote(content).body.length);
  return `---\n${host.io.codec.stringify({
    ...note.properties,
    ...changes,
  }).trimEnd()}\n---\n`;
}
export type AssignmentPlan = BatchPlan & { addedSection: boolean };
export function assignmentPlan(host: ItineraryDataHost, model: ItineraryModel, note: ItineraryNote, request: AssignmentRequest): AssignmentPlan {
  const parts = splitNote(note.snapshot.content);
  const resolve = linkResolver(host.io.paths(), note.snapshot.path);
  // Shortest form that still finds the note, as Obsidian writes links by default.
  const base = noteName(request.target);
  const linkText = request.linkText ?? (resolve(`[[${base}]]`) === request.target
    ? base
    : request.target.replace(/\.md$/, ''));
  const preview = previewAssignment(parts.body, note.properties[note.type.mappings.activities], note.type.days, note, { ...request, linkText }, resolve);
  const changes = { [note.type.mappings.activities]: preview.membership };
  const summary = assignmentSummary(note, request, preview.addedSection);
  const step: BatchStep = preview.body === parts.body
    ? {
        before: note.snapshot,
        kind: 'properties',
        changes,
        summary,
      }
    : {
        before: note.snapshot,
        kind: 'content',
        after: frontmatter(host, note, changes, preview.membership) + preview.body,
        summary,
      };
  const sources = model.activities.filter(activity => activity.snapshot.path === request.target).map(activity => activity.snapshot);
  if (note !== model.trip)
    sources.push(model.trip.snapshot);
  return Object.assign(batchPlan([step], sources), { addedSection: preview.addedSection });
}
/**
 * Puts activity `path` on `date` in `to`, at `index` (end when omitted). Coming from another entry, it leaves that
 * day there too, and stops being that entry's activity when it was on no other day of it.
 */
export function movePlan(host: ItineraryDataHost, model: ItineraryModel, path: string, to: EntryRow, date: string, from?: { row: EntryRow; date: string }, index?: number): BatchPlan {
  if (from && from.row.note.snapshot.path === to.note.snapshot.path) {
    return assignmentPlan(host, model, to.note, {
      action: 'reassign',
      target: path,
      fromDay: from.date,
      day: date,
      index,
    });
  }
  const add = assignmentPlan(host, model, to.note, {
    action: 'day-add',
    target: path,
    day: date,
    index,
  });
  if (!from)
    return add;
  const elsewhere = [
    ...from.row.days.flatMap(day => day.activities.map(activity => ({ ...activity, date: day.date }))),
    ...from.row.outside,
  ].some(activity => activity.path === path && activity.date !== from.date);
  return combine([
    assignmentPlan(host, model, from.row.note, elsewhere
      ? { action: 'day-remove', target: path, day: from.date }
      : { action: 'full-remove', target: path }),
    add,
  ]);
}
export function removalPlan(host: ItineraryDataHost, model: ItineraryModel, note: ItineraryNote, action: 'detach' | 'attach' | 'trash'): BatchPlan {
  const step = action === 'trash'
    ? trashPreview(note.snapshot)
    : relationshipPreview(note.snapshot, note.type, host.io.codec, action === 'attach'
        ? model.trip.snapshot.path
        : undefined);
  return batchPlan([step], note === model.trip
    ? []
    : [model.trip.snapshot]);
}
/** Several single-file changes as one undoable step, e.g. an activity leaving one entry's day for another's. */
export function combine(plans: BatchPlan[]): BatchPlan {
  const steps = plans.flatMap(plan => plan.steps);
  const written = new Set(steps.map(step => step.before.path));
  return batchPlan(steps, [
    ...new Map(plans.flatMap(plan => plan.sources).filter(source => !written.has(source.path)).map(source => [source.path, source])).values(),
  ]);
}
export async function applyPlan(host: ItineraryDataHost, model: ItineraryModel, plan: BatchPlan): Promise<BatchReport> {
  if (JSON.stringify(host.settings) !== model.profile)
    throw new Error('Configuration changed; close this action and try again');
  if (!plan.restores) {
    for (const step of plan.steps) {
      if (plan.receipts.has(step.before.path))
        continue;
      const current = host.index.find(note => note.path === step.before.path);
      const original = [
        model.trip,
        ...model.entries,
        ...model.activities,
        ...model.detached,
      ].find(note => note.snapshot.path === step.before.path);
      if (!original || current?.typeId !== original.type.id || current.parentPath !== original.parentPath || current.diagnostics.some(d => d.capability === 'recognition'))
        throw new Error('Recognition or parent context changed; nothing was written');
    }
  }
  return applyBatch(host.io, plan);
}
