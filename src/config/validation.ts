import type { FieldDefinition } from '../types';
import { moment } from 'obsidian';

export function validateName(name: string): string[] {
  const errors: string[] = [];
  if (!name.trim() || name === '.' || name === '..')
    errors.push('Enter a nonempty note name other than . or ..');
  if (/[ .]$/.test(name))
    errors.push('Names cannot end in a space or period');
  if ([...name].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))
    errors.push('Control characters are not allowed');
  if (/[/\\:*?"<>|#^[\]]/.test(name))
    errors.push('Name contains an unsafe filename or link character');
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name))
    errors.push('Reserved device names are not allowed');
  return errors;
}

/** True for a non-empty string: what `if (value)` means for an optional string. */
export function filled(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

export function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '0001-01-01'
    && moment.utc(value, 'YYYY-MM-DD', true).isValid();
}

export const pathTokens = ['trip_name', 'entry_name', 'trip_start_year'];
export function validateTokens(text: string, context: 'path' | 'template', fields: string[] = []): string[] {
  const errors: string[] = [];
  const remaining = text.replace(/\{\{([^{}]+)\}\}/g, (_, token: string) => {
    const accepted = context === 'path'
      ? pathTokens.includes(token)
      : /^(?:start_date|end_date|date)(?::[^\r\n]+)?$/.test(token)
        || pathTokens.includes(token) || fields.includes(token);
    if (!accepted)
      errors.push(`Unsupported ${context} placeholder: {{${token}}}`);
    return '';
  });
  if (remaining.includes('{{') || remaining.includes('}}'))
    errors.push('Malformed placeholder');
  return errors;
}

export function validatePath(path: string): string[] {
  if (!path || path.startsWith('/') || path.endsWith('/'))
    return ['Choose a vault-relative file path'];
  return path.split('/').flatMap(validateName);
}

export function validatePattern(pattern: string): string[] {
  return [
    ...validateTokens(pattern, 'path'),
    ...validatePath(pattern.replace(/\{\{[^{}]+\}\}/g, 'Name')),
  ];
}

export function isNoteLink(value: unknown): value is string {
  return typeof value === 'string' && /^\[\[[^[\]\r\n]+\]\]$/.test(value);
}

export function validateField(field: FieldDefinition, value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return field.required
      ? `${field.label} is required`
      : undefined;
  }
  let valid = false;
  switch (field.type) {
    case 'text': valid = typeof value === 'string';
      break;
    case 'number': valid = typeof value === 'number' && Number.isFinite(value);
      break;
    case 'boolean': valid = typeof value === 'boolean';
      break;
    case 'date': valid = validDate(value);
      break;
    case 'url': {
      try {
        valid = typeof value === 'string' && ['http:', 'https:'].includes(new URL(value).protocol);
      }
      catch { valid = false; }
      break;
    }
    case 'note-link': valid = isNoteLink(value);
      break;
    case 'text-list': valid = Array.isArray(value) && value.every(v => typeof v === 'string');
      break;
    case 'note-link-list': valid = Array.isArray(value) && value.every(isNoteLink);
      break;
  }
  return valid
    ? undefined
    : `${field.label} must be ${field.type}`;
}
