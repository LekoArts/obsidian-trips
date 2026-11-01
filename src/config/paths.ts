import { filled, validateName, validatePath, validatePattern, validDate } from './validation';

/** A note's name: its file name without `.md`. */
export const noteName = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');

export interface PathContext {
  tripName: string;
  entryName: string;
  tripStart?: string;
  isTrip?: boolean;
  explicitDestination?: string;
}
export function resolvePath(pattern: string, context: PathContext): string {
  const errors = [
    ...validatePattern(pattern),
    ...validateName(context.tripName),
    ...validateName(context.entryName),
  ];
  if (errors.length)
    throw new Error(errors.join('; '));
  if (filled(context.explicitDestination)) {
    const invalid = validatePath(context.explicitDestination);
    if (invalid.length || !context.explicitDestination.endsWith('.md'))
      throw new Error('Choose a valid Markdown destination');
    return context.explicitDestination;
  }
  if (pattern.includes('{{trip_start_year}}') && !validDate(context.tripStart))
    throw new Error('Trip start year is missing; choose an explicit destination');
  const values: Record<string, string> = {
    trip_name: context.tripName,
    entry_name: context.isTrip ? context.tripName : context.entryName,
    trip_start_year: context.tripStart?.slice(0, 4) ?? '',
  };
  const path = pattern.replace(/\{\{([^{}]+)\}\}/g, (_, key: string) => values[key] ?? '');
  if (validatePath(path).length || !path.endsWith('.md'))
    throw new Error('Destination must be a valid Markdown path');
  return path;
}
