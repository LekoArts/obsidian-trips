import { expect, it } from 'vitest';
import { newType } from '../../config/profile';
import { dayFormatMismatch } from '../../travel/day-sections';
import { formatFix, formatWarning } from '../day-format';

const planning = {
  ...newType('planning', 'entry'),
  label: 'Planning',
};
function copy(headings: string[]) {
  const mismatch = dayFormatMismatch(headings, 'YYYY-MM-DD')!;
  return [
    formatFix(mismatch, 'YYYY-MM-DD'),
    formatWarning(planning, mismatch),
  ];
}

it('names the one detected format and offers the switch', () => {
  expect(copy(['10.05.2026', '11.05.2026'])).toEqual([
    'Switch the day-heading format to DD.MM.YYYY in Trips settings.',
    'Your Planning notes use a different format for day headings: DD.MM.YYYY (like 10.05.2026). They aren’t read as days until you switch.',
  ]);
});
it('names every format a lone ambiguous heading could be instead of guessing one', () => {
  expect(copy(['05/06/2026'])).toEqual([
    'They could be DD/MM/YYYY or MM/DD/YYYY: set the one you use in Trips settings.',
    'Your Planning day headings, like 05/06/2026, could be DD/MM/YYYY or MM/DD/YYYY, so they aren’t read as days. Set the one you use here.',
  ]);
});
it('lists mixed formats, leading with the configured one when some headings already use it', () => {
  expect(copy(['10.05.2026', '12/05/2026'])).toEqual([
    'They mix DD.MM.YYYY and DD/MM/YYYY; only YYYY-MM-DD is read.',
    'Your Planning day headings mix DD.MM.YYYY and DD/MM/YYYY; only YYYY-MM-DD is read as days. Use one format in the notes, then set it here.',
  ]);
  expect(copy(['2026-05-10', '05/06/2026'])[0]).toBe('They mix YYYY-MM-DD with DD/MM/YYYY or MM/DD/YYYY; only YYYY-MM-DD is read.');
});
