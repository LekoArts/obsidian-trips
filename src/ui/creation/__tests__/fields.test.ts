import { expect, it } from 'vitest';
import { fieldProblem, parseFields, rangeProblems } from '../fields';

it('end before start and dates outside the trip are reported per field', () => {
  expect(rangeProblems('2026-05-10', '2026-05-09')).toEqual({ start: '', end: 'End date is before the start date' });
  expect(rangeProblems('2026-05-01', '2026-05-12', '2026-05-05', '2026-05-20').start).toMatch(/within the trip/);
  expect(rangeProblems('2026-05-06', '2026-05-21', '2026-05-05', '2026-05-20').end).toMatch(/within the trip/);
  expect(rangeProblems('2026-05-06', '2026-05-06', '2026-05-05', '2026-05-20')).toEqual({ start: '', end: '' });
});
it('image-like text fields need a web address', () => {
  const banner = {
    key: 'banner',
    label: 'Banner',
    type: 'text' as const,
    required: false,
  };
  expect(fieldProblem(banner, 'photo.jpg')).toMatch(/https:\/\//);
  expect(fieldProblem(banner, 'https://example.com/a.jpg')).toBe('');
  expect(fieldProblem(banner, 'https://?')).toMatch(/https:\/\//);
  expect(fieldProblem(banner, 'https://exa mple.com')).toMatch(/https:\/\//);
  expect(fieldProblem({ ...banner, type: 'url' }, 'x')).toMatch(/https/);
  expect(() => parseFields([banner], { banner: 'nope' })).toThrow(/https/);
  expect(fieldProblem({ ...banner, key: 'Location', label: 'Location' }, 'Busan')).toBe('');
});
it('an untouched toggle means no, so a required yes/no field never blocks silently', () => {
  const done = {
    key: 'Done',
    label: 'Done',
    type: 'boolean' as const,
    required: true,
  };
  expect(parseFields([done], {})).toEqual({ Done: false });
});
