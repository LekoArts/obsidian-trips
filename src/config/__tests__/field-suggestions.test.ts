import { expect, it } from 'vitest';
import { dateProperties, suggestFields } from '../field-suggestions';
import { newType } from '../profile';

it('suggests bounded typed fields but never infers semantic mappings', () => {
  const type = newType('trip');
  const fields = suggestFields({
    kind: 'trip',
    base: '[[Trips.base]]',
    startDate: '{{date}}',
    empty: null,
    price: 10,
    done: false,
    people: [],
    place: '[[Seoul]]',
  }, type);
  expect(fields.map(field => [field.key, field.type])).toEqual([
    ['empty', 'text'],
    ['price', 'number'],
    ['done', 'boolean'],
    ['people', 'text-list'],
    ['place', 'note-link'],
  ]);
  expect(type.fields).toEqual([]);
  expect(type.mappings.start).toBe('startDate');
});

it('finds the properties that hold the date placeholders, whatever they are called', () => {
  expect(dateProperties({ title: 'x', begins: '{{start_date}}', finishes: '{{end_date:DD.MM.YYYY}}' })).toMatchObject({ start: 'begins', end: 'finishes' });
  // Legacy templates only have {{date}}; it stands for the start.
  expect(dateProperties({ day: '{{date}}' })).toMatchObject({ start: 'day', end: undefined });
  // {{start_date}} wins over an older {{date}} elsewhere.
  expect(dateProperties({ note: 'Made {{date}}', from: '{{start_date}}', to: '{{end_date}}' })).toMatchObject({ start: 'from', end: 'to' });
});
it('without placeholders, date-like property names are offered so the user can be told what to fill in', () => {
  expect(dateProperties({
    kind: 'journey',
    begins: null,
    finishes: null,
    journeyBase: '[[x]]',
  })).toEqual({
    start: undefined,
    end: undefined,
    named: { start: 'begins', end: 'finishes' },
  });
  expect(dateProperties({ startDate: '{{start_date}}', endDate: null })).toEqual({
    start: 'startDate',
    end: undefined,
    named: { start: undefined, end: 'endDate' },
  });
  expect(dateProperties({ count: 3, ending: 'x' }).named).toEqual({ start: undefined, end: 'ending' });
});
