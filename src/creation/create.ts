import type { YamlCodec } from '../config/template-render';
import type { FileSnapshot, ReadIO } from '../editing/conflicts';
import type { FieldDefinition, NoteType } from '../types';
import { noteName, resolvePath } from '../config/paths';
import { parseProperties, renderNewNote, splitNote } from '../config/template-render';
import { filled, validateField, validateName, validDate } from '../config/validation';
import { assertFresh } from '../editing/conflicts';
import { previewAssignment } from '../travel/assignments';
import { assertRange } from '../travel/dates';
import { generateDays } from '../travel/day-sections';

export interface ParentNote extends FileSnapshot { type: NoteType }
export interface CreationDraft {
  type: NoteType;
  name: string;
  start?: string;
  end?: string;
  fields: Record<string, unknown>;
  destination?: string;
  parent?: ParentNote;
  /** What goes inside `[[…]]` for the parent link; defaults to the parent's path. */
  parentLink?: string;
  /** Activities this entry starts with: the link text, and the day to list it under, if any. */
  activities?: { link: string; day?: string }[];
}
export interface CreationIO extends ReadIO {
  codec: YamlCodec;
  createNote: (path: string, content: string) => Promise<void>;
}
export interface CreationPlan { files: FileSnapshot[]; sources: FileSnapshot[] }
export interface CreationReport { completed: string[]; failed?: string; error?: string; untouched: string[] }
export function assertWithinParent(parent: ParentNote, start: string, end: string, codec: YamlCodec): void {
  const properties = parseProperties(splitNote(parent.content).yaml, codec);
  const first = properties[parent.type.mappings.start];
  const last = properties[parent.type.mappings.end];
  if (!validDate(first) || !validDate(last) || first > last)
    throw new Error('Parent trip needs valid ordered start and end dates before dated creation or rescheduling');
  if (start < first || end > last)
    throw new Error('Dates are outside the parent trip; explicitly extend the trip first');
}
function validateDraft({ type, name, start, end, parent }: CreationDraft, codec: YamlCodec): void {
  const errors = validateName(name);
  if (errors.length)
    throw new Error(errors.join('; '));
  if (type.role !== 'trip' && (!parent || parent.type.role !== 'trip'))
    throw new Error('Choose an unambiguous parent trip');
  if (type.dated || filled(start) || filled(end) || type.days.enabled) {
    assertRange(start, end);
    if (parent && filled(end))
      assertWithinParent(parent, start, end, codec);
  }
}
/** A field the form left out gets its default; one the user cleared stays empty. */
function fieldOrDefault(draft: CreationDraft, field: FieldDefinition): unknown {
  return Object.hasOwn(draft.fields, field.key)
    ? draft.fields[field.key]
    : field.defaultValue;
}
/** The properties a new note gets on top of its template's: fields, recognition, Base, parent, activities, dates. */
function draftProperties(draft: CreationDraft): Record<string, unknown> {
  const { type, start, end, parent } = draft;
  const properties: Record<string, unknown> = {};
  for (const field of type.fields) {
    const value = fieldOrDefault(draft, field);
    const invalid = validateField(field, value);
    if (filled(invalid))
      throw new Error(invalid);
    // A cleared field is written empty, so a value in the template's frontmatter doesn't come back.
    if (value !== undefined || Object.hasOwn(draft.fields, field.key))
      properties[field.key] = value ?? null;
  }
  properties[type.recognition.property] = type.recognition.value;
  if (type.basePath)
    properties[type.baseProperty] = `[[${type.basePath}]]`;
  if (parent)
    properties[type.mappings.parent] = `[[${draft.parentLink ?? parent.path}]]`;
  if (draft.activities !== undefined && draft.activities.length > 0 && type.role === 'entry' && type.mappings.activities)
    properties[type.mappings.activities] = draft.activities.map(activity => `[[${activity.link}]]`);
  if (filled(start))
    properties[type.mappings.start] = start;
  if (filled(end))
    properties[type.mappings.end] = end;
  return properties;
}
/** Activities given a day go under that day's activity heading, as the trip tab would put them. */
function placeActivities(body: string, { type, start, end, activities = [] }: CreationDraft): string {
  if (type.role !== 'entry')
    return body;
  const known = new Map(activities.map(activity => [`[[${activity.link}]]`, activity.link]));
  let result = body;
  for (const activity of activities.filter(activity => filled(activity.day))) {
    result = previewAssignment(result, [], type.days, { start: start ?? '', end: end ?? '' }, { action: 'day-add', target: activity.link, day: activity.day }, link => known.get(link)).body;
  }
  return result;
}
export function prepareNote(draft: CreationDraft, template: string, codec: YamlCodec): FileSnapshot {
  const { type, name, start, end, parent } = draft;
  validateDraft(draft, codec);
  const parentProperties = parent
    ? parseProperties(splitNote(parent.content).yaml, codec)
    : {};
  const tripStart = parent ? parentProperties[parent.type.mappings.start] : start;
  const tripName = parent
    ? noteName(parent.path)
    : name;
  const path = resolvePath(type.pathPattern, {
    tripName,
    entryName: name,
    tripStart: validDate(tripStart)
      ? tripStart
      : undefined,
    isTrip: type.role === 'trip',
    explicitDestination: draft.destination,
  });
  const properties = draftProperties(draft);
  const rendered = renderNewNote(template, {
    start,
    end,
    tripName,
    entryName: name,
    tripStart: validDate(tripStart)
      ? tripStart
      : undefined,
    fields: Object.fromEntries(type.fields.map(field => [
      field.key,
      fieldOrDefault(draft, field),
    ])),
  }, properties, codec);
  const parts = splitNote(rendered);
  const body = placeActivities(generateDays(parts.body, start ?? '', end ?? '', type.days), draft);
  return { path, content: rendered.slice(0, rendered.length - parts.body.length) + body };
}
async function draftTemplate(io: CreationIO, type: NoteType, sources: FileSnapshot[]): Promise<string> {
  if (!type.template)
    return type.minimalBody;
  const source = { path: type.template, content: await io.read(type.template) };
  await assertFresh(io, source);
  sources.push(source);
  return source.content;
}
/** A parent planned earlier in the same batch must match; an existing one must not have changed. */
async function checkParent(io: CreationIO, parent: ParentNote, files: FileSnapshot[], sources: FileSnapshot[]): Promise<void> {
  const planned = files.find(file => file.path === parent.path);
  if (planned && planned.content !== parent.content)
    throw new Error('The parent note changed while creating; check it and try again');
  if (!planned) {
    await assertFresh(io, parent);
    sources.push(parent);
  }
}
export async function previewCreation(io: CreationIO, drafts: CreationDraft[]): Promise<CreationPlan> {
  const files: FileSnapshot[] = [];
  const sources: FileSnapshot[] = [];
  for (const draft of [...drafts].sort((a, b) => Number(b.type.role === 'trip') - Number(a.type.role === 'trip'))) {
    const template = await draftTemplate(io, draft.type, sources);
    if (draft.parent)
      await checkParent(io, draft.parent, files, sources);
    if (draft.type.basePath && !io.exists(draft.type.basePath))
      throw new Error('Selected Base no longer exists');
    const note = prepareNote(draft, template, io.codec);
    if (io.exists(note.path) || files.some(file => file.path.toLowerCase() === note.path.toLowerCase()))
      throw new Error(`Destination exists: ${note.path}`);
    files.push(note);
  }
  return { files, sources };
}
export async function applyCreation(io: CreationIO, plan: CreationPlan): Promise<CreationReport> {
  const completed: string[] = [];
  for (const file of plan.files) {
    try {
      for (const source of plan.sources) await assertFresh(io, source);
      for (const pending of plan.files.filter(item => !completed.includes(item.path))) {
        if (io.exists(pending.path))
          throw new Error(`Destination exists: ${pending.path}`);
      }
      await io.createNote(file.path, file.content);
      completed.push(file.path);
    }
    catch (error) {
      return {
        completed,
        failed: file.path,
        error: String(error),
        untouched: plan.files.filter(item => !completed.includes(item.path) && item.path !== file.path).map(item => item.path),
      };
    }
  }
  return { completed, untouched: [] };
}
