import type { FieldDefinition } from '../types';
import { validDate } from '../config/validation';
import { CliError } from './reply';

/** What `trips:create` was asked for, before any note is looked up. */
export interface CreateRequest {
  kind: string;
  name: string;
  start?: string;
  end?: string;
  trip?: string;
  fields: Record<string, unknown>;
  activities: { name: string; day?: string }[];
}

const invalid = (message: string) => new CliError('INVALID_INPUT', message);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function refuseUnknown(input: Record<string, unknown>, known: string[], what: string): void {
  const unknown = Object.keys(input).filter(key => !known.includes(key));
  if (unknown.length) {
    throw invalid(`Unknown ${what} ${unknown.join(', ')}; ${known.length
      ? `use ${known.join(', ')}`
      : `there are none`}`);
  }
}

/**
 * A request given either as flags or as one `json=` flag holding the whole request, never both. Flag values arrive as
 * strings (a bare flag as "true"); JSON keeps its types.
 */
export function readInput(flags: Record<string, string>, flagKeys: string[], jsonKeys: string[]): Record<string, unknown> {
  if (!Object.hasOwn(flags, 'json')) {
    refuseUnknown(flags, [...flagKeys, 'json'], 'flag');
    return { ...flags };
  }
  if (Object.keys(flags).length > 1)
    throw invalid('Pass either flags or json=, not both');
  let parsed: unknown;
  try {
    parsed = JSON.parse(flags.json ?? '');
  }
  catch {
    throw invalid('json= is not valid JSON; wrap it in single quotes');
  }
  if (!isRecord(parsed))
    throw invalid('json= must hold a JSON object');
  refuseUnknown(parsed, jsonKeys, 'key');
  return parsed;
}

export function text(input: Record<string, unknown>, key: string, required: true): string;
export function text(input: Record<string, unknown>, key: string, required?: false): string | undefined;
export function text(input: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = input[key];
  if (value === undefined || value === '') {
    if (required)
      throw invalid(`${key} is required`);
    return undefined;
  }
  if (typeof value !== 'string')
    throw invalid(`${key} must be text`);
  return value;
}

function activities(value: unknown): CreateRequest['activities'] {
  if (value === undefined)
    return [];
  if (!Array.isArray(value))
    throw invalid('activities must be a list of { "name": …, "day": "YYYY-MM-DD" }');
  return value.map((item) => {
    if (!isRecord(item))
      throw invalid('activities must be a list of { "name": …, "day": "YYYY-MM-DD" }');
    refuseUnknown(item, ['name', 'day'], 'activity key');
    return {
      name: text(item, 'name', true),
      day: text(item, 'day'),
    };
  });
}

export function createRequest(flags: Record<string, string>): CreateRequest {
  const input = readInput(flags, ['kind', 'name', 'start', 'end', 'trip'], [
    'kind',
    'name',
    'start',
    'end',
    'trip',
    'fields',
    'activities',
  ]);
  const fields = input.fields ?? {};
  if (!isRecord(fields))
    throw invalid('fields must be an object of field key → value');
  return {
    kind: text(input, 'kind', true),
    name: text(input, 'name', true),
    start: text(input, 'start'),
    end: text(input, 'end'),
    trip: text(input, 'trip'),
    fields,
    activities: activities(input.activities),
  };
}

function fieldString(field: FieldDefinition, value: unknown): string {
  const wrong = () => invalid(`${field.key} must be ${field.type}`);
  if (value === null)
    return '';
  if (typeof value === 'string')
    return value;
  if (typeof value === 'number') {
    if (field.type !== 'number')
      throw wrong();
    return String(value);
  }
  if (typeof value === 'boolean') {
    if (field.type !== 'boolean')
      throw wrong();
    return String(value);
  }
  if (Array.isArray(value)) {
    // The form keeps one list item per line, so an item can't hold a line break.
    if (!field.type.endsWith('-list') || !value.every(item => typeof item === 'string' && !/[\r\n]/.test(item)))
      throw wrong();
    return value.join('\n');
  }
  throw wrong();
}

/**
 * Field values as the creation form holds them. A key left out stays out, so it gets the field's default exactly as
 * in the form; an explicit empty value (`""`, `[]` or `null`) clears the field.
 */
export function fieldStrings(fields: FieldDefinition[], values: Record<string, unknown>): Record<string, string> {
  refuseUnknown(values, fields.map(field => field.key), 'field');
  return Object.fromEntries(fields.filter(field => Object.hasOwn(values, field.key)).map(field => [
    field.key,
    fieldString(field, values[field.key]),
  ]));
}

/** What `trips:assign` was asked for. `position` is 1-based; left out, the activity goes last on the day. */
export interface AssignRequest {
  trip: string;
  activity: string;
  action: 'add' | 'move' | 'remove';
  entry: string;
  day?: string;
  fromEntry?: string;
  fromDay?: string;
  position?: number;
}
/** What `trips:reschedule` was asked for: new dates for one entry, or for the trip itself when `entry` is left out. */
export interface RescheduleRequest { trip: string; entry?: string; start: string; end: string; extend: boolean }

function date(input: Record<string, unknown>, key: string, required: true): string;
function date(input: Record<string, unknown>, key: string, required?: false): string | undefined;
function date(input: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = required
    ? text(input, key, true)
    : text(input, key);
  if (value !== undefined && !validDate(value))
    throw invalid(`${key} must be a YYYY-MM-DD date`);
  return value;
}

function refusePresent(input: Record<string, unknown>, keys: string[], why: string): void {
  const present = keys.filter(key => input[key] !== undefined);
  if (present.length)
    throw invalid(`${present.join(', ')} ${why}`);
}

function position(value: unknown): number | undefined {
  if (value === undefined)
    return undefined;
  const number = typeof value === 'string' && /^[1-9]\d*$/.test(value)
    ? Number(value)
    : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1)
    throw invalid('position must be a whole number from 1 (first on the day)');
  return number;
}

const ASSIGN_KEYS = [
  'trip',
  'activity',
  'action',
  'entry',
  'day',
  'from-entry',
  'from-day',
  'position',
];

export function assignRequest(flags: Record<string, string>): AssignRequest {
  const input = readInput(flags, ASSIGN_KEYS, ASSIGN_KEYS);
  const action = text(input, 'action', true);
  if (action !== 'add' && action !== 'move' && action !== 'remove')
    throw invalid('action must be add, move or remove');
  const common = {
    trip: text(input, 'trip', true),
    activity: text(input, 'activity', true),
    action,
    entry: text(input, 'entry', true),
  } as const;
  if (action === 'remove') {
    refusePresent(input, ['from-entry', 'from-day', 'position'], 'only apply to add and move');
    return {
      ...common,
      day: date(input, 'day'),
    };
  }
  if (action === 'add')
    refusePresent(input, ['from-entry', 'from-day'], 'only apply to move');
  return {
    ...common,
    day: date(input, 'day', true),
    ...(action === 'move'
      ? {
          fromEntry: text(input, 'from-entry'),
          fromDay: date(input, 'from-day', true),
        }
      : {}),
    position: position(input.position),
  };
}

const RESCHEDULE_KEYS = [
  'trip',
  'entry',
  'start',
  'end',
  'extend',
];

export function rescheduleRequest(flags: Record<string, string>): RescheduleRequest {
  const input = readInput(flags, RESCHEDULE_KEYS, RESCHEDULE_KEYS);
  // A bare flag arrives as "true"; anything else, "false" included, would be a guess.
  if (input.extend !== undefined && input.extend !== 'true' && input.extend !== true)
    throw invalid('extend takes no value: pass it as a bare flag, or "extend": true in json');
  const entry = text(input, 'entry');
  const extend = input.extend !== undefined;
  if (extend && entry === undefined)
    throw invalid('extend only applies when rescheduling an entry; to change the trip\'s dates, leave out entry');
  return {
    trip: text(input, 'trip', true),
    entry,
    start: date(input, 'start', true),
    end: date(input, 'end', true),
    extend,
  };
}
