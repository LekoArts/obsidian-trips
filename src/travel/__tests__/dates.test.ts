import { expect, it } from 'vitest';
import { addDays, dayOffset, inclusiveDays, readableDayFormat } from '../dates';

it.each([
  ['2026-02-28', 1, '2026-03-01'],
  ['2028-02-28', 1, '2028-02-29'],
  ['2028-03-01', -1, '2028-02-29'],
  ['2026-12-31', 1, '2027-01-01'],
  ['2000-02-28', 2, '2000-03-01'],
  ['1900-02-28', 1, '1900-03-01'],
  ['2026-03-08', 1, '2026-03-09'],
] as const)('offset %s by %s', (date, offset, expected) => {
  expect(addDays(date, offset)).toBe(expected);
  expect(dayOffset(date, expected)).toBe(offset);
});
it('inclusive single day and leap range', () => {
  expect(inclusiveDays('2026-05-27', '2026-05-27')).toEqual(['2026-05-27']);
  expect(inclusiveDays('2028-02-28', '2028-03-01')).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
});
it('reject invalid, reversed, noninteger and overflow dates', () => {
  expect(() => addDays('2026-02-29', 1)).toThrow();
  expect(() => addDays('0001-01-01', -1)).toThrow();
  expect(() => addDays('9999-12-31', 1)).toThrow();
  expect(() => addDays('2026-01-01', 0.5)).toThrow();
  expect(() => inclusiveDays('2026-02-02', '2026-02-01')).toThrow();
});
it('a day-heading format must name one exact day so it can be read back', () => {
  for (const format of [
    'DD.MM.YYYY',
    'YYYY-MM-DD',
    'ddd D MMM YYYY',
    'D. MMMM YYYY',
  ])
    expect(readableDayFormat(format)).toBe(true);
  for (const format of [
    'MM-DD',
    'dddd',
    'YYYY',
    '# YYYY-MM-DD',
    '',
  ])
    expect(readableDayFormat(format)).toBe(false);
});
