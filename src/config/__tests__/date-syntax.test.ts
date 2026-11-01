import { expect, it } from 'vitest';
import { validateTokens, validDate } from '../validation';

it.each(['date', 'start_date', 'end_date'].flatMap(key => [key, `${key}:YYYY-MM-DD`, `${key}:DD.MM.YYYY`]))('supports %s', (token) => {
  expect(validateTokens(`{{${token}}}`, 'template')).toEqual([]);
});
it.each([
  'date:YYYY',
  'date:MM/DD/YYYY',
  'start_date:dddd, D. MMMM',
  'end_date:HH:mm',
])('accepts any Moment format, like core Templates: %s', (token) => {
  expect(validateTokens(`{{${token}}}`, 'template')).toEqual([]);
});
it.each([
  'now',
  'trip_start_year:YYYY',
  'date:',
])('rejects %s', (token) => {
  expect(validateTokens(`{{${token}}}`, 'template')).toHaveLength(1);
});
it('bounds path placeholders separately from date tokens and fields', () => {
  expect(validateTokens('{{trip_name}}/{{entry_name}}/{{trip_start_year}}', 'path')).toEqual([]);
  expect(validateTokens('{{date}}', 'path')).toHaveLength(1);
  expect(validateTokens('{{Location}}', 'template', ['Location'])).toEqual([]);
  expect(validateTokens('{{date}', 'template')).toHaveLength(1);
});
it.each([
  '2026-02-29',
  '2026-13-01',
  '0000-01-01',
  '2026-01-00',
  '2026-1-1',
  '2026-04-31',
])('rejects invalid calendar date %s', value => expect(validDate(value)).toBe(false));
it.each(['2028-02-29', '2026-12-31', '2000-02-29'])('accepts %s', value => expect(validDate(value)).toBe(true));
