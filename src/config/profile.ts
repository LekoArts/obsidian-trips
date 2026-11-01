import type { Diagnostic, FieldDefinition, NoteType, PlannerSettings, Profile } from '../types';
import { readableDayFormat } from '../travel/dates';
import { recognisedByBase } from './recognition';
import { filled, validateField, validateName, validatePath, validatePattern, validateTokens } from './validation';

export function newType(id: string, role: NoteType['role'] = 'trip'): NoteType {
  return {
    id,
    label: id,
    role,
    template: '',
    minimalBody: '',
    pathPattern: 'Travel/{{entry_name}}.md',
    recognition: { property: 'kind', value: id },
    basePath: '',
    baseProperty: 'base',
    dated: role !== 'activity',
    fields: [],
    mappings: {
      start: 'startDate',
      end: 'endDate',
      parent: role === 'trip'
        ? ''
        : 'backlink',
      activities: 'Activities',
    },
    days: {
      enabled: false,
      dateFormat: 'YYYY-MM-DD',
      headingLevel: 2,
      activityHeading: 'Activities',
      activityLevel: 3,
    },
  };
}
export function emptySettings(): PlannerSettings {
  return {
    version: 1,
    profile: {
      name: 'Custom travel',
      scopes: ['Travel'],
      types: [],
    },
    resolutions: {},
  };
}
export function presetProfile(): Profile {
  const definitions: [string, string, NoteType['role'], string, string][] = [
    [
      'simple',
      'Simple',
      'trip',
      'Travel_Simple',
      '_templates/Bases/Travel.base',
    ],
    [
      'advanced',
      'Advanced',
      'trip',
      'Travel_Advanced',
      '_templates/Bases/Travel.base',
    ],
    [
      'roadtrip',
      'Roadtrip',
      'trip',
      'Travel_Roadtrip',
      '_templates/Bases/Travel.base',
    ],
    [
      'planning',
      'Planning',
      'entry',
      'Planning',
      '_templates/Bases/Planning.base',
    ],
    [
      'stop',
      'Stop',
      'entry',
      'Stop',
      '_templates/Bases/Roadtrip.base',
    ],
    [
      'activity',
      'Activity',
      'activity',
      'Activity',
      '_templates/Bases/Activities.base',
    ],
  ];
  const folders: Record<string, string> = { stop: 'Roadtrip', activity: 'Activities' };
  const pathPattern = (id: string, role: NoteType['role']) => {
    if (id === 'simple')
      return 'Travel/{{trip_start_year}}/{{trip_name}}.md';
    if (role === 'trip')
      return 'Travel/{{trip_start_year}}/{{trip_name}}/{{entry_name}}.md';
    return `Travel/{{trip_start_year}}/{{trip_name}}/${folders[id] ?? 'Planning'}/{{entry_name}}.md`;
  };
  const done: FieldDefinition = {
    key: 'Done',
    label: 'Done',
    type: 'boolean',
    required: false,
    defaultValue: false,
  };
  const fields: Partial<Record<NoteType['role'], FieldDefinition[]>> = {
    trip: [
      {
        key: 'Persons',
        label: 'Persons',
        type: 'text-list',
        required: false,
        defaultValue: [],
      },
      done,
      {
        key: 'banner',
        label: 'Banner',
        type: 'url',
        required: false,
      },
    ],
    activity: [
      {
        key: 'Location',
        label: 'Location',
        type: 'text',
        required: false,
      },
      done,
    ],
  };
  const contains: Record<string, string[]> = {
    advanced: ['planning', 'activity'],
    roadtrip: ['stop'],
  };
  return {
    name: 'Travel preset',
    scopes: ['Travel'],
    types: definitions.map(([id, label, role, template, basePath]) => ({
      ...newType(id, role),
      label,
      template: `_templates/${template}.md`,
      basePath,
      recognition: { property: 'base', value: `[[${basePath}]]` },
      pathPattern: pathPattern(id, role),
      fields: structuredClone(fields[role] ?? []),
      days: {
        ...newType(id).days,
        enabled: id === 'planning',
      },
      ...(role === 'trip'
        ? { contains: contains[id] ?? [] }
        : {}),
    })),
  };
}

export interface ProfileFiles { exists: (path: string) => boolean; template: (path: string) => string | undefined }
type Report = (message: string) => void;

function checkFiles(type: NoteType, files: ProfileFiles | undefined, add: Report): void {
  if (files && type.template && !files.exists(type.template))
    add(`Template not found: ${type.template}`);
  if (files && type.basePath && !files.exists(type.basePath))
    add(`Base not found: ${type.basePath}`);
  if (type.basePath && !type.baseProperty.trim())
    add('Base link property is required');
  const body = type.template
    ? files?.template(type.template)
    : type.minimalBody;
  if (body !== undefined) {
    for (const error of validateTokens(body, 'template', type.fields.map(f => f.key))) add(error);
  }
}

/** Checks the property names a kind writes; returns them, with the ones creation reserves. */
function checkMappings(type: NoteType, add: Report): { mapped: string[]; reserved: string[] } {
  if (type.dated && (!type.mappings.start || !type.mappings.end))
    add('Dated types need start and end mappings');
  if (type.role !== 'trip' && !type.mappings.parent)
    add('Child types need a parent mapping');
  const mapped = Object.values(type.mappings).filter((property): property is string => Boolean(property));
  if (new Set(mapped).size !== mapped.length)
    add('Semantic mappings must use distinct properties');
  // New notes get the recognition and Base link properties too, so a date or parent written there would replace them.
  const reserved = [
    type.recognition.property,
    ...(type.basePath
      ? [type.baseProperty]
      : []),
  ];
  if (mapped.some(property => reserved.includes(property)))
    add('Property names must differ from the recognition and Base link properties');
  if (type.basePath && type.baseProperty === type.recognition.property && !recognisedByBase(type))
    add('Recognition and Base link use the same property with different values');
  return { mapped, reserved };
}

function checkDays(type: NoteType, add: Report): void {
  const day = type.days;
  if (day.enabled && (!type.dated || !type.mappings.activities))
    add('Daily sections need dates and an activity mapping');
  const levels = Number.isInteger(day.headingLevel) && day.headingLevel >= 1 && day.headingLevel <= 5
    && Number.isInteger(day.activityLevel) && day.activityLevel > day.headingLevel && day.activityLevel <= 6;
  if (!levels || !day.activityHeading.trim() || /[\r\n]/.test(day.activityHeading))
    add('Choose valid nested day and activity headings');
  if (!readableDayFormat(day.dateFormat))
    add('Day-heading format must name the day, month and year');
}

function checkFields(type: NoteType, taken: string[], add: Report): void {
  const keys = new Set<string>();
  for (const field of type.fields) {
    if (!field.key.trim() || keys.has(field.key) || taken.includes(field.key))
      add(`Duplicate or protected field: ${field.key}`);
    keys.add(field.key);
    const error = field.defaultValue === undefined
      ? undefined
      : validateField(field, field.defaultValue);
    if (filled(error))
      add(error);
  }
}

function checkKind(type: NoteType, files: ProfileFiles | undefined, add: Report): void {
  if (!type.label.trim())
    add('Type needs a label');
  for (const error of validatePattern(type.pathPattern)) add(error);
  if (!type.pathPattern.endsWith('.md'))
    add('Destination must end with .md');
  if (!type.recognition.property.trim() || !type.recognition.value.trim())
    add('Choose a recognition property and value');
  checkFiles(type, files, add);
  const { mapped, reserved } = checkMappings(type, add);
  checkDays(type, add);
  checkFields(type, [
    ...mapped,
    ...reserved,
  ], add);
  if (validateName(type.id).length)
    add('Choose a safe type ID');
}

export function validateProfile(profile: Profile, files?: ProfileFiles): Diagnostic[] {
  const result: Diagnostic[] = [];
  const add = (path: string, message: string) => result.push({ path, message, capability: 'configuration' });
  if (!profile.name.trim())
    add('', 'Profile needs a name');
  if (!profile.scopes.length)
    add('', 'Choose at least one discovery folder');
  for (const scope of profile.scopes) {
    for (const error of validatePath(scope)) add(scope, error);
  }
  const ids = new Set<string>();
  for (const type of profile.types) {
    if (!type.id || ids.has(type.id))
      add(type.id, 'Type IDs must be nonempty and unique');
    ids.add(type.id);
    checkKind(type, files, message => add(type.id, message));
  }
  return result;
}

/** The child kinds a trip template shows, judged by which kinds' Bases it embeds or links. */
export function containedKinds(template: string, types: NoteType[]): NoteType[] {
  return types.filter(type => type.role !== 'trip' && type.basePath !== '' && (template.includes(type.basePath) || template.includes(`${type.basePath.split('/').pop()?.replace(/\.base$/, '')}.base`)));
}
/**
 * The kinds a trip can hold. An explicit `contains` list wins. Older profiles fall back to the Bases the trip note
 * (or else its template) embeds, plus any kind without a Base, since nothing says where that one belongs.
 */
export function tripContents(trip: NoteType, types: NoteType[], ...texts: string[]): NoteType[] {
  const inside = types.filter(type => type.role !== 'trip');
  if (trip.contains)
    return inside.filter(type => trip.contains?.includes(type.id));
  const embedded = texts.map(text => containedKinds(text, types)).find(found => found.length) ?? [];
  return inside.filter(type => embedded.includes(type) || !type.basePath);
}
