import { expect, it } from 'vitest';
import { validateName, validatePattern } from '../validation';

it.each([
  ...'/\\:*?"<>|#^[]',
  ...Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)),
  String.fromCharCode(127),
])('rejects unsafe character %j', (char) => {
  expect(validateName(`a${char}b`).length).toBeGreaterThan(0);
});
it.each([
  '',
  ' ',
  '\t',
  '.',
  '..',
  'name.',
  'name ',
  ...[
    'CON',
    'PRN',
    'AUX',
    'NUL',
    ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
    ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
  ].flatMap(name => [
    name,
    name.toLowerCase(),
    `${name}.md`,
    `${name.toLowerCase()}.txt`,
  ]),
])('rejects %j', (name) => {
  expect(validateName(name).length).toBeGreaterThan(0);
});
it.each([
  '서울',
  'Café (2026)',
  'A & B',
  'internal  spaces',
  'COM0',
  'COM10',
  'LPT10',
  'CONtent',
  ' leading',
])('preserves %s', (name) => {
  expect(validateName(name)).toEqual([]);
});
it('path separators are intentional, traversal is not', () => {
  expect(validatePattern('Travel/{{trip_name}}/{{entry_name}}.md')).toEqual([]);
  expect(validatePattern('../{{entry_name}}.md').length).toBeGreaterThan(0);
});
