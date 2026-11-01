import type { FieldDefinition } from '../../types';
import { filled, validateField } from '../../config/validation';
import { rangeLabel } from '../itinerary/layout';

export function fieldText(value: unknown): string {
  if (value == null)
    return '';
  if (Array.isArray(value)) {
    return value.map(item => typeof item === 'string'
      ? item
      : JSON.stringify(item)).join('\n');
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return JSON.stringify(value) ?? '';
}
// A toggle that was never touched shows off, so it means no.
const booleans: Record<string, boolean> = { 'true': true, 'false': false, '': false };
function fieldValue(field: FieldDefinition, text: string): unknown {
  if (field.type.endsWith('-list')) {
    return text
      ? text.split('\n')
      : [];
  }
  if (field.type === 'number') {
    return text
      ? Number(text)
      : undefined;
  }
  if (field.type === 'boolean') {
    return Object.hasOwn(booleans, text)
      ? booleans[text]
      : text;
  }
  return text || undefined;
}
export function parseFields(fields: FieldDefinition[], values: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(fields.map((field): [string, unknown] => {
    const text = values[field.key] ?? fieldText(field.defaultValue);
    const value = fieldValue(field, text);
    const invalid = fieldProblem(field, text) || validateField(field, value);
    if (filled(invalid))
      throw new Error(invalid);
    return [field.key, value];
  }));
}
function webAddress(text: string): boolean {
  if (/\s/.test(text))
    return false;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname.length > 0;
  }
  catch { return false; }
}
const URL_KEY = /banner|image|cover|photo|picture|url|link|website/i;
/** Text fields whose name suggests a web address get URL help and validation. */
export const urlLike = (field: FieldDefinition) => field.type === 'url' || (field.type === 'text' && URL_KEY.test(field.key));
export function fieldProblem(field: FieldDefinition, text: string): string {
  if (urlLike(field) && text && !webAddress(text))
    return `${field.label} needs a full web address starting with https://`;
  return '';
}
/** Problems with a start/end pair, optionally limited to the trip's dates. Empty strings mean no problem. */
export function rangeProblems(start: string, end: string, min?: string, max?: string): { start: string; end: string } {
  const outside = (value: string) => value && ((filled(min) && value < min) || (filled(max) && value > max))
    ? `Must be within the trip (${rangeLabel(min ?? '', max ?? '')})`
    : '';
  return {
    start: outside(start),
    end: start && end && end < start
      ? 'End date is before the start date'
      : outside(end),
  };
}
