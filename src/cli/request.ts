import type { FieldDefinition } from '../types';
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
