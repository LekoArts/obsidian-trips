import { expect, it } from 'vitest';
import { resolvePath } from '../paths';

const context = { tripName: '서울 & coast', entryName: 'Day (1)', tripStart: '2026-05-27' };
it('expands exact values without normalizing Unicode', () => {
  expect(resolvePath('Travel/{{trip_start_year}}/{{trip_name}}/{{entry_name}}.md', context)).toBe('Travel/2026/서울 & coast/Day (1).md');
});
it('trip creation uses trip name for both names', () => {
  expect(resolvePath('{{trip_name}}/{{entry_name}}.md', { ...context, isTrip: true })).toBe('서울 & coast/서울 & coast.md');
});
it('missing year never falls back to the clock', () => {
  expect(() => resolvePath('{{trip_start_year}}/{{entry_name}}.md', { ...context, tripStart: undefined })).toThrow('explicit destination');
  expect(resolvePath('{{trip_start_year}}/{{entry_name}}.md', { ...context, tripStart: undefined, explicitDestination: 'Elsewhere/New.md' })).toBe('Elsewhere/New.md');
});
it.each([
  '../bad.md',
  '/bad.md',
  'a//b.md',
  'a/CON.md',
  'a.txt',
])('rejects unsafe explicit destination %s', (path) => {
  expect(() => resolvePath('{{entry_name}}.md', { ...context, explicitDestination: path })).toThrow();
});
