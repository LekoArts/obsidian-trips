import type { RecognizedNote } from '../../types';
import { expect, it } from 'vitest';
import { newType } from '../../config/profile';
import { dayFormatOffers } from '../day-format';

const planning = {
  ...newType('planning', 'entry'),
  label: 'Planning',
  days: {
    ...newType('planning', 'entry').days,
    enabled: true,
  },
};
const stop = {
  ...newType('stop', 'entry'),
  label: 'Stop',
};
function offers(notes: Record<string, string[]>) {
  return dayFormatOffers(
    [planning, stop],
    Object.keys(notes).map(path => ({
      path,
      typeId: path.startsWith('Stop')
        ? 'stop'
        : 'planning',
    }) as RecognizedNote),
    path => notes[path] ?? [],
  ).map(({ type, suggestion, message }) => ({ kind: type.id, suggestion, message }));
}

it('offers the one format existing notes use, judged across every note of the kind', () => {
  expect(offers({
    'Busan.md': ['10.05.2026', 'Notes'],
    'Jeju.md': ['13.05.2026'],
  })).toEqual([
    {
      kind: 'planning',
      suggestion: 'DD.MM.YYYY',
      message: 'Your Planning notes write day headings as DD.MM.YYYY (like 10.05.2026), but this setup uses YYYY-MM-DD. Use DD.MM.YYYY so they\'re read as days? Your notes stay as they are.',
    },
  ]);
});
it('offers no switch when it would stop other headings being read, and names formats instead of guessing', () => {
  expect(offers({
    'Busan.md': ['10.05.2026'],
    'Lyon.md': ['2026-07-02'],
  })).toEqual([
    {
      kind: 'planning',
      suggestion: undefined,
      message: 'Your Planning day headings mix YYYY-MM-DD with DD.MM.YYYY; only YYYY-MM-DD is read as days. Use one format in the notes, then set it under Planning → Day-heading format.',
    },
  ]);
  expect(offers({
    'Busan.md': ['05/06/2026'],
  })[0]?.message).toBe('Your Planning day headings, like 05/06/2026, could be DD/MM/YYYY or MM/DD/YYYY, so they aren\'t read as days. Set the one you use under Planning → Day-heading format.');
});
it('says nothing when headings already match, or for kinds without day sections', () => {
  expect(offers({
    'Busan.md': ['2026-05-10'],
    'Stop Sokcho.md': ['10.05.2026'],
  })).toEqual([]);
});
