import { getFrontMatterInfo } from 'obsidian';
import { formatDate } from '../travel/dates';
import { validateTokens, validDate } from './validation';

export interface RenderValues {
  start?: string;
  end?: string;
  tripName: string;
  entryName: string;
  tripStart?: string;
  fields?: Record<string, unknown>;
}
function fieldText(token: string, value: unknown): string {
  if (value == null)
    return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (Array.isArray(value) && value.every(item => typeof item === 'string'))
    return value.join(', ');
  throw new Error(`Unsupported field value for {{${token}}}`);
}
export function renderTemplate(text: string, values: RenderValues): string {
  const errors = validateTokens(text, 'template', Object.keys(values.fields ?? {}));
  if (errors.length)
    throw new Error(errors.join('; '));
  return text.replace(/\{\{([^{}]+)\}\}/g, (_, token: string) => {
    const colon = token.indexOf(':');
    const name = colon < 0
      ? token
      : token.slice(0, colon);
    if (name === 'date' || name === 'start_date' || name === 'end_date') {
      const date = name === 'end_date'
        ? values.end
        : values.start;
      if (!validDate(date))
        throw new Error(`Enter a date for {{${token}}}`);
      return formatDate(date, colon < 0
        ? 'YYYY-MM-DD'
        : token.slice(colon + 1));
    }
    if (name === 'trip_name')
      return values.tripName;
    if (name === 'entry_name')
      return values.entryName;
    if (name === 'trip_start_year') {
      if (!validDate(values.tripStart))
        throw new Error('Trip start year is missing');
      return values.tripStart.slice(0, 4);
    }
    return fieldText(token, values.fields?.[token]);
  });
}
export interface YamlCodec { parse: (text: string) => unknown; stringify: (value: Record<string, unknown>) => string }
export function splitNote(content: string): { yaml?: string; body: string } {
  const info = getFrontMatterInfo(content);
  if (info.exists) {
    return {
      yaml: info.frontmatter,
      body: content.slice(info.contentStart),
    };
  }
  // Obsidian sees no frontmatter here, but a write would then add a second one above the broken block.
  if (/^---\r?\n/.test(content))
    throw new Error('Unclosed YAML frontmatter; correct the note first');
  return { body: content };
}
export function parseProperties(yaml: string | undefined, codec: YamlCodec): Record<string, unknown> {
  if (yaml === undefined || !yaml.trim())
    return {};
  let value: unknown;
  try {
    value = codec.parse(yaml);
  }
  catch { throw new Error('Malformed YAML frontmatter; correct the note first'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Frontmatter must be a property mapping');
  return Object.fromEntries(Object.entries(value));
}
/** Render parsed scalar values, never interpolate user input into YAML syntax. */
export function renderNewNote(template: string, values: RenderValues, properties: Record<string, unknown>, codec: YamlCodec): string {
  const errors = validateTokens(template, 'template', Object.keys(values.fields ?? {}));
  if (errors.length)
    throw new Error(errors.join('; '));
  const parts = splitNote(template);
  const renderValue = (value: unknown): unknown => {
    if (typeof value === 'string')
      return renderTemplate(value, values);
    if (Array.isArray(value))
      return value.map(renderValue);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [
        key,
        renderValue(child),
      ]));
    }
    return value;
  };
  const source = parseProperties(parts.yaml, codec);
  const rendered = Object.fromEntries(Object.entries(source).map(([key, value]) => [
    key,
    Object.hasOwn(properties, key)
      ? properties[key]
      : renderValue(value),
  ]));
  return `---\n${codec.stringify({
    ...rendered,
    ...properties,
  }).trimEnd()}\n---\n${renderTemplate(parts.body, values)}`;
}
