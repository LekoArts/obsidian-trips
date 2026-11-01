import type { RecognizedNote } from '../../types';
import { expect, it } from 'vitest';
import { newType } from '../../config/profile';
import { attentionItems } from '../attention';

const trip = newType('trip');
const other = newType('other');
const entry = newType('entry', 'entry');
function note(path: string, extra: Partial<RecognizedNote>): RecognizedNote {
  return {
    path,
    candidates: [],
    parentCandidates: [],
    diagnostics: [],
    ...extra,
  };
}
function problem(path: string, capability: 'recognition' | 'parent' | 'dates', message = 'Something; detail') {
  return [
    { path, message, capability },
  ];
}

it('lists problem notes newest trip first with short problems and context', () => {
  const notes = [
    note('Travel/2019/Old/Old.md', {
      candidates: ['trip', 'other'],
      diagnostics: problem('x', 'recognition'),
    }),
    note('Travel/2019/Old/Stop.md', {
      candidates: ['entry'],
      typeId: 'entry',
      diagnostics: problem('x', 'parent'),
    }),
    note('Travel/2026/New/New.md', {
      candidates: ['trip'],
      typeId: 'trip',
    }),
    note('Travel/2026/New/Day.md', {
      candidates: ['entry'],
      typeId: 'entry',
      parentCandidates: ['Travel/2026/New/New.md'],
      parentPath: 'Travel/2026/New/New.md',
      diagnostics: problem('x', 'dates', 'End before start; fix it'),
    }),
    note('Travel/2024/Twice.md', {
      candidates: ['entry'],
      typeId: 'entry',
      parentCandidates: ['a.md', 'b.md'],
      diagnostics: problem('x', 'parent'),
    }),
  ];
  const properties = new Map<string, Record<string, unknown>>([
    [
      'Travel/2026/New/New.md',
      { startDate: '2026-05-01' },
    ],
    [
      'Travel/2019/Old/Stop.md',
      { startDate: '2019-08-02' },
    ],
  ]);
  expect(attentionItems(notes, [trip, other, entry], properties)).toEqual([
    {
      path: 'Travel/2026/New/Day.md',
      label: 'Day',
      context: 'New',
      problem: 'End before start',
    },
    {
      path: 'Travel/2024/Twice.md',
      label: 'Twice',
      context: 'Travel/2024',
      problem: 'Links to several trips; choose one',
    },
    {
      path: 'Travel/2019/Old/Stop.md',
      label: 'Stop',
      context: 'Travel/2019/Old',
      problem: 'Its trip link doesn’t lead to a trip',
    },
    {
      path: 'Travel/2019/Old/Old.md',
      label: 'Old',
      context: 'Trip',
      problem: 'Matches several kinds; choose one',
    },
  ]);
});
