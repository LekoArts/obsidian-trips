import { validDate } from '../config/validation';

export interface Span { start: string; end: string }
export function validSpan(span: Span): boolean {
  return validDate(span.start) && validDate(span.end) && span.start <= span.end;
}
/**
 * New explicit dates for one entry (move or change length). Only that entry changes. Throws when the
 * trip has no valid dates or the result is unordered; `outside` reports the trip range it would need.
 */
export function setSpan(trip: Span, entry: Span, next: Span): { outside?: Span } {
  if (!validSpan(trip))
    throw new Error('Set valid ordered parent trip dates before rescheduling');
  if (!validSpan(entry))
    throw new Error('Repair this entry\'s dates first');
  if (!validSpan(next))
    throw new Error('An entry ends on or after the day it starts');
  if (next.start >= trip.start && next.end <= trip.end)
    return {};
  return {
    outside: {
      start: next.start < trip.start
        ? next.start
        : trip.start,
      end: next.end > trip.end
        ? next.end
        : trip.end,
    },
  };
}
