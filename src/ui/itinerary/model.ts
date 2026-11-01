import type { App } from 'obsidian';
import type { YamlCodec } from '../../config/template-render';
import type { BatchIO } from '../../editing/batch';
import type { FileSnapshot } from '../../editing/conflicts';
import type { Occurrence } from '../../travel/assignments';
import type { DayFormatMismatch } from '../../travel/day-sections';
import type { NoteType, PlannerSettings, RecognizedNote } from '../../types';
import type { CreationOptions } from '../creation/modal';
import { tripContents } from '../../config/profile';
import { parseProperties, splitNote } from '../../config/template-render';
import { filled } from '../../config/validation';
import { capture } from '../../editing/conflicts';
import { dailyOccurrences } from '../../travel/assignments';
import { kindDayFormatMismatch } from '../day-format';

export interface ItineraryDataHost {
  settings: PlannerSettings;
  index: RecognizedNote[];
  io: BatchIO & { paths: () => string[]; codec: YamlCodec; headings: (path: string, level: number) => string[] };
}
export interface ItineraryHost extends ItineraryDataHost { app: App; subscribe: (listener: (notes: RecognizedNote[]) => void) => () => void; openCreation: (options: CreationOptions) => void }
/** What a trip tab remembers across restarts: UI state only, never trip data. */
export interface TabState { path: string }
export interface ItineraryNote {
  snapshot: FileSnapshot;
  type: NoteType;
  properties: Record<string, unknown>;
  start: string;
  end: string;
  parentPath?: string;
  diagnostics: string[];
  daily: Occurrence[];
  /** Headings at the day-heading level, from the same source as the kind-wide `dayFormats` verdict so both agree. */
  dayHeadings: string[];
}
export interface ItineraryModel {
  profile: string;
  trip: ItineraryNote;
  entries: ItineraryNote[];
  activities: ItineraryNote[];
  detached: ItineraryNote[];
  /** Entry kinds shown as sections: those the trip embeds a Base for (else its template does), kinds without a Base, and kinds it already has. */
  kinds: NoteType[];
  /** Ids of the entry kinds this trip may get new notes of. */
  creatable: string[];
  /** The kind + Activity creates: one whose Base the trip embeds, else the kind of its existing activities, else one without a Base. */
  activityKind?: NoteType;
  /** Per entry kind id, its day headings in another date format across the vault, the same verdict settings shows. */
  dayFormats: Record<string, DayFormatMismatch>;
}
export function tripPaths(host: ItineraryDataHost): string[] {
  return host.index.filter(note => host.settings.profile.types.find(type => type.id === note.typeId)?.role === 'trip' && !note.diagnostics.some(d => d.capability === 'recognition')).map(note => note.path);
}
export async function loadItinerary(host: ItineraryDataHost, path: string): Promise<ItineraryModel> {
  async function load(note: RecognizedNote): Promise<ItineraryNote> {
    const type = host.settings.profile.types.find(type => type.id === note.typeId);
    if (!type || note.diagnostics.some(d => d.capability === 'recognition'))
      throw new Error(`${note.path}: resolve recognition in settings`);
    const snapshot = await capture(host.io, note.path);
    const parts = splitNote(snapshot.content);
    const properties = parseProperties(parts.yaml, host.io.codec);
    const start = properties[type.mappings.start];
    const end = properties[type.mappings.end];
    // Date problems are recomputed per row by the trip layout, so only the other capabilities are carried here.
    const diagnostics = note.diagnostics.filter(d => d.capability !== 'dates').map(d => d.message);
    let daily: Occurrence[] = [];
    try {
      daily = dailyOccurrences(parts.body, type.days);
    }
    catch (error) { diagnostics.push(String(error)); }
    return {
      snapshot,
      type: structuredClone(type),
      properties,
      parentPath: note.parentPath,
      start: typeof start === 'string'
        ? start
        : '',
      end: typeof end === 'string'
        ? end
        : '',
      diagnostics,
      daily,
      dayHeadings: type.role === 'entry'
        ? host.io.headings(note.path, type.days.headingLevel)
        : [],
    };
  }
  const recognized = host.index.find(note => note.path === path);
  if (!recognized || !tripPaths(host).includes(path))
    throw new Error('Trip disappeared or became ambiguous. Choose a trip or resolve its configuration.');
  const trip = await load(recognized);
  const entries: ItineraryNote[] = [];
  const activities: ItineraryNote[] = [];
  const detached: ItineraryNote[] = [];
  // A detached note has no link to say which trip it left, so only notes in this trip's own folder are offered back.
  const folderOf = (file: string) => file.slice(0, file.lastIndexOf('/'));
  const tripFolders = tripPaths(host).map(folderOf);
  const home = folderOf(path);
  const ownFolder = tripFolders.filter(folder => folder === home).length === 1;
  const inThisTrip = (file: string) => ownFolder && file.startsWith(`${home}/`) && !tripFolders.some(folder => folder.length > home.length && file.startsWith(`${folder}/`));
  for (const note of host.index) {
    if (!filled(note.typeId) || note.diagnostics.some(d => d.capability === 'recognition'))
      continue;
    if (note.parentPath !== path && !(note.detached && inThisTrip(note.path)))
      continue;
    const child = await load(note);
    if (!filled(child.parentPath))
      detached.push(child);
    else if (child.type.role === 'activity')
      activities.push(child);
    else entries.push(child);
  }
  const types = host.settings.profile.types;
  const contained = tripContents(trip.type, types, trip.snapshot.content, host.io.exists(trip.type.template)
    ? await host.io.read(trip.type.template)
    : '');
  // Kinds that already have notes in this trip always show, dated or not.
  const has = (notes: ItineraryNote[], type: NoteType) => notes.some(note => note.type.id === type.id);
  const kinds = types.filter(type => type.role === 'entry' && (has(entries, type) || contained.includes(type)));
  const activityTypes = types.filter(type => type.role === 'activity');
  // An explicit Contains list decides what can be created; existing notes of other kinds still show.
  const explicit = Array.isArray(trip.type.contains);
  const activityKind = explicit
    ? activityTypes.find(type => contained.includes(type) && has(activities, type)) ?? activityTypes.find(type => contained.includes(type))
    : activityTypes.find(type => type.basePath !== '' && contained.includes(type)) ?? activityTypes.find(type => has(activities, type)) ?? activityTypes.find(type => contained.includes(type));
  const creatable = kinds.filter(type => !explicit || contained.includes(type)).map(type => type.id);
  return {
    profile: JSON.stringify(host.settings),
    trip,
    entries,
    activities,
    detached,
    kinds: structuredClone(kinds),
    creatable,
    activityKind: activityKind && structuredClone(activityKind),
    // Only the kinds this trip has, as each verdict scans every note of its kind in the vault.
    dayFormats: Object.fromEntries(host.settings.profile.types.filter(type => entries.some(entry => entry.type.id === type.id)).flatMap((type) => {
      const mismatch = kindDayFormatMismatch(type, host.index, host.io.headings.bind(host.io));
      return mismatch
        ? [
            [type.id, mismatch],
          ]
        : [];
    })),
  };
}
