import { expect, it } from 'vitest';
import { setSpan } from '../schedule';

const trip = { start: '2026-05-01', end: '2026-05-31' };
const entry = { start: '2026-05-10', end: '2026-05-12' };
it('a span inside the trip needs no extension', () => {
  expect(setSpan(trip, entry, { start: '2026-05-11', end: '2026-05-14' })).toEqual({});
});
it('a span past either end reports the trip range it would need', () => {
  expect(setSpan(trip, entry, { start: '2026-04-29', end: '2026-05-02' }).outside).toEqual({ start: '2026-04-29', end: '2026-05-31' });
  expect(setSpan(trip, entry, { start: '2026-05-30', end: '2026-06-02' }).outside).toEqual({ start: '2026-05-01', end: '2026-06-02' });
});
it('d17: no dated change without valid ordered trip dates; broken or reversed spans refused', () => {
  expect(() => setSpan({ start: '', end: '' }, entry, entry)).toThrow('parent');
  expect(() => setSpan({ start: '2026-06-01', end: '2026-05-01' }, entry, entry)).toThrow('parent');
  expect(() => setSpan(trip, { start: 'x', end: '2026-05-12' }, entry)).toThrow('Repair');
  expect(() => setSpan(trip, entry, { start: '2026-05-12', end: '2026-05-11' })).toThrow('ends on or after');
});
