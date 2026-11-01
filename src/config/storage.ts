import type { NoteType, PlannerSettings, Profile } from '../types';
import { emptySettings } from './profile';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isType(value: unknown): value is NoteType {
  if (!record(value))
    return false;
  if (![
    'id',
    'label',
    'template',
    'minimalBody',
    'pathPattern',
    'basePath',
    'baseProperty',
  ].every(key => typeof value[key] === 'string')) {
    return false;
  }
  if (!['trip', 'entry', 'activity'].includes(String(value.role)) || typeof value.dated !== 'boolean')
    return false;
  const recognition = value.recognition;
  if (!record(recognition) || typeof recognition.property !== 'string' || typeof recognition.value !== 'string')
    return false;
  const mappings = value.mappings;
  if (!record(mappings) || !['start', 'end', 'parent', 'activities'].every(key => typeof mappings[key] === 'string'))
    return false;
  const days = value.days;
  if (!record(days) || typeof days.enabled !== 'boolean' || typeof days.dateFormat !== 'string' || typeof days.headingLevel !== 'number' || typeof days.activityLevel !== 'number' || typeof days.activityHeading !== 'string')
    return false;
  if (value.contains !== undefined && !(Array.isArray(value.contains) && value.contains.every(id => typeof id === 'string')))
    return false;
  return Array.isArray(value.fields) && value.fields.every(field => record(field)
    && typeof field.key === 'string' && typeof field.label === 'string' && typeof field.required === 'boolean'
    && [
      'text',
      'number',
      'boolean',
      'date',
      'url',
      'text-list',
      'note-link',
      'note-link-list',
    ].includes(String(field.type)));
}
export function isProfile(value: unknown): value is Profile {
  return record(value) && typeof value.name === 'string' && Array.isArray(value.scopes)
    && value.scopes.every(scope => typeof scope === 'string') && Array.isArray(value.types) && value.types.every(isType);
}
export function decodeSettings(value: unknown): PlannerSettings {
  if (value == null)
    return emptySettings();
  if (!record(value) || value.version !== 1 || !isProfile(value.profile) || !record(value.resolutions))
    throw new Error('Saved travel settings have an unsupported shape; no settings or notes were changed');
  const settings = emptySettings();
  settings.profile = value.profile;
  for (const [path, resolution] of Object.entries(value.resolutions)) {
    if (!record(resolution) || typeof resolution.typeId !== 'string' || (resolution.parentPath !== undefined && typeof resolution.parentPath !== 'string'))
      throw new Error('Saved recognition choices are invalid');
    settings.resolutions[path] = { typeId: resolution.typeId, parentPath: resolution.parentPath };
  }
  return settings;
}
