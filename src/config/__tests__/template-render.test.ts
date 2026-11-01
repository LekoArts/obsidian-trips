import { expect, it } from 'vitest';
import { parseProperties, renderNewNote, renderTemplate, splitNote } from '../template-render';

const values = {
  start: '2026-05-27',
  end: '2026-05-30',
  tripStart: '2026-05-20',
  tripName: 'Trip',
  entryName: 'Stop',
};
const codec = {
  parse: (text: string): unknown => JSON.parse(text),
  stringify: (value: Record<string, unknown>) => JSON.stringify(value),
};
it('distinct start/end, legacy alias and suffixes', () => {
  expect(renderTemplate('{{start_date}} {{end_date}} {{date:DD.MM.YYYY}} {{end_date:DD.MM.YYYY}} {{date:YYYY-MM-DD}}', values)).toBe('2026-05-27 2026-05-30 27.05.2026 30.05.2026 2026-05-27');
});
it('names, year and configured field tokens', () => {
  expect(renderTemplate('{{trip_name}}/{{entry_name}}/{{trip_start_year}} {{People}}', {
    ...values,
    fields: {
      People: ['A', 'B'],
    },
  })).toBe('Trip/Stop/2026 A, B');
});
it.each([
  '{{unknown}}',
  '{{date',
  '{{end_date:}}',
])('reject unsupported %s', text => expect(() => renderTemplate(text, values)).toThrow());
it('date tokens take any Moment format, including ones with colons', () => {
  expect(renderTemplate('{{date:dddd D MMMM}} | {{end_date:YYYY/MM/DD HH:mm}}', values)).toBe('Wednesday 27 May | 2026/05/30 00:00');
});
it('missing date/year has no fallback', () => {
  expect(() => renderTemplate('{{date}}', { ...values, start: undefined })).toThrow();
  expect(() => renderTemplate('{{trip_start_year}}', { ...values, tripStart: undefined })).toThrow();
});
it('mapped frontmatter dates override legacy body alias independently and user text cannot inject YAML', () => {
  const template = `---\n${JSON.stringify({
    begins: '{{date}}',
    finishes: '{{date}}',
    name: '{{entry_name}}',
    unknown: 42,
  })}\n---\n{{date}} / {{end_date}}`;
  const result = renderNewNote(template, { ...values, entryName: 'a"\nadmin: true' }, { begins: values.start, finishes: values.end }, codec);
  const parts = splitNote(result);
  expect(parseProperties(parts.yaml, codec)).toEqual({
    begins: values.start,
    finishes: values.end,
    name: 'a"\nadmin: true',
    unknown: 42,
  });
  expect(parts.body).toBe('2026-05-27 / 2026-05-30');
});
it('unsupported tokens in overwritten mapped properties still reject the template', () => {
  expect(() => renderNewNote('---\n{"begins":"{{when}}"}\n---\nBody', values, { begins: values.start }, codec)).toThrow('Unsupported');
});
it('malformed frontmatter blocks creation', () => {
  expect(() => splitNote('---\nx: 1')).toThrow();
  expect(() => parseProperties('invalid', codec)).toThrow('Malformed YAML');
  expect(() => parseProperties('[]', codec)).toThrow('mapping');
});
it('frontmatter Obsidian doesn\'t see is refused, not edited as body', () => {
  expect(() => splitNote('---\na: 1\n---   \nBody')).toThrow('Unclosed');
  expect(splitNote('---\r\na: 1\r\n---\r\nBody')).toEqual({ yaml: 'a: 1\r\n', body: 'Body' });
  expect(splitNote('Body\n---\n')).toEqual({ body: 'Body\n---\n' });
});
