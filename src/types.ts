export type FieldType = 'text' | 'number' | 'boolean' | 'date' | 'url' | 'text-list' | 'note-link' | 'note-link-list';
export interface FieldDefinition {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  defaultValue?: unknown;
}
export interface PropertyMappings {
  start: string;
  end: string;
  parent: string;
  activities: string;
}
export interface DaySections {
  enabled: boolean;
  /** Moment.js format of day headings. */
  dateFormat: string;
  headingLevel: number;
  activityHeading: string;
  activityLevel: number;
}
export interface NoteType {
  id: string;
  label: string;
  role: 'trip' | 'entry' | 'activity';
  template: string;
  minimalBody: string;
  pathPattern: string;
  recognition: { property: string; value: string };
  basePath: string;
  baseProperty: string;
  dated: boolean;
  fields: FieldDefinition[];
  mappings: PropertyMappings;
  days: DaySections;
  /** Trip kinds only: ids of the kinds a trip of this kind contains. Absent in older profiles, which fall back to Base detection. */
  contains?: string[];
}
export interface Profile {
  name: string;
  scopes: string[];
  types: NoteType[];
}
export interface Diagnostic {
  path: string;
  message: string;
  capability: 'configuration' | 'recognition' | 'dates' | 'activities' | 'parent';
}
export interface Resolution { typeId: string; parentPath?: string }
export interface PlannerSettings {
  version: 1;
  profile: Profile;
  resolutions: Record<string, Resolution>;
}
export interface NoteSnapshot {
  path: string;
  properties: Record<string, unknown>;
  /** Link targets of the note's embeds (`![[…]]`). */
  embeds?: string[];
}
export interface RecognizedNote {
  path: string;
  candidates: string[];
  typeId?: string;
  parentCandidates: string[];
  parentPath?: string;
  /** No parent link: detached on purpose, which is a valid state and not something to report. */
  detached?: boolean;
  diagnostics: Diagnostic[];
}
