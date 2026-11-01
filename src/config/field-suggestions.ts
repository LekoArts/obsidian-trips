import type { FieldDefinition, FieldType, NoteType } from '../types';
import { filled, isNoteLink, validDate } from './validation';

export function suggestFields(properties: Record<string, unknown>, type: NoteType): FieldDefinition[] {
  const protectedKeys = new Set([
    type.mappings.start,
    type.mappings.end,
    type.mappings.parent,
    type.mappings.activities,
    type.baseProperty,
    type.recognition.property,
    'position',
  ]);
  return Object.entries(properties).filter(([key]) => !protectedKeys.has(key) && !type.fields.some(field => field.key === key)).map(([key, value]) => {
    let kind: FieldType = 'text';
    if (typeof value === 'boolean') {
      kind = 'boolean';
    }
    else if (typeof value === 'number') {
      kind = 'number';
    }
    else if (validDate(value)) {
      kind = 'date';
    }
    else if (isNoteLink(value)) {
      kind = 'note-link';
    }
    else if (typeof value === 'string' && /^https?:\/\//.test(value)) {
      kind = 'url';
    }
    else if (Array.isArray(value)) {
      kind = value.length && value.every(isNoteLink)
        ? 'note-link-list'
        : 'text-list';
    }
    return {
      key,
      label: key,
      type: kind,
      required: false,
      defaultValue: value ?? undefined,
    };
  });
}

/**
 * The properties a template fills with the start and end date placeholders (`{{date}}` is the old start placeholder).
 * Without a placeholder, a property named like a start or end date is returned as `named`, so the user can be told to add one.
 */
export function dateProperties(properties: Record<string, unknown>): { start?: string; end?: string; named: { start?: string; end?: string } } {
  const keys = Object.keys(properties);
  const holding = (pattern: RegExp) => keys.find(key => typeof properties[key] === 'string' && pattern.test(properties[key]));
  const start = holding(/\{\{\s*start_date\b/) ?? holding(/\{\{\s*date\b/);
  const end = holding(/\{\{\s*end_date\b/);
  const named = (pattern: RegExp) => keys.find(key => pattern.test(key) && key !== start && key !== end);
  return {
    start,
    end,
    named: {
      start: filled(start)
        ? undefined
        : named(/^(?:start|begin|from|arriv)/i),
      end: filled(end)
        ? undefined
        : named(/^(?:end|finish|until|to$|depart)/i),
    },
  };
}

/** A trip template with nothing but what Trips needs, for people starting without one. */
export const starterTemplate = '---\nstartDate: "{{start_date}}"\nendDate: "{{end_date}}"\n---\n\n## Plan\n\n';
