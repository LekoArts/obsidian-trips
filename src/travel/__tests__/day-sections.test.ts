import type { DaySections } from '../../types';
import { expect, it } from 'vitest';
import { generateDays } from '../day-sections';

const config: DaySections = {
  enabled: true,
  dateFormat: 'YYYY-MM-DD',
  headingLevel: 2,
  activityLevel: 3,
  activityHeading: 'Activities',
};
const generate = (body: string, end = '2026-05-27') => generateDays(body, '2026-05-27', end, config);
it('single/multiple inclusive days append after unchanged prose', () => {
  const body = 'Authored prose  \n\n# Intro\nText';
  expect(generate(body)).toBe(`${body}\n\n## 2026-05-27\n\n### Activities\n\n`);
  expect(generate(body, '2026-05-28')).toContain('## 2026-05-28');
});
it('complete sections are byte-identical and reused', () => {
  const body = '## 2026-05-27\nText\n### Activities\n- [[Visit]]\n';
  expect(generate(body)).toBe(body);
  expect(generate(generate(body))).toBe(body);
});
it('insert only missing subsection before next same/higher-level heading', () => {
  const body = '## 2026-05-27\nProse\n### Other\nKeep this\n# Tail\nUntouched';
  expect(generate(body)).toBe('## 2026-05-27\nProse\n### Other\nKeep this\n\n### Activities\n\n# Tail\nUntouched');
});
it('several days missing their subsection each get one, in place, around unrelated text', () => {
  const body = '## 2026-05-27\nA\n## 2026-05-28\n### Activities\n- [[X]]\n## 2026-05-29\nC\n## Footer\nEnd';
  expect(generate(body, '2026-05-29')).toBe('## 2026-05-27\nA\n\n### Activities\n\n## 2026-05-28\n### Activities\n- [[X]]\n## 2026-05-29\nC\n\n### Activities\n\n## Footer\nEnd');
});
it.each(['## 2026-05-27\n## 2026-05-27\n', '## 2026-05-27\n### Activities\n### Activities\n'])('ambiguous headings refuse instead of guessing', (body) => {
  expect(() => generate(body)).toThrow('Duplicate');
});
it('fenced headings ignored including longer fences and tildes', () => {
  for (const marker of ['```', '~~~~']) {
    const body = `${marker}\n## 2026-05-27\n### Activities\n### Activities\n${marker}\n`;
    expect(generate(body)).toBe(`${body}\n## 2026-05-27\n\n### Activities\n\n`);
  }
  expect(() => generate('```\ncode')).toThrow('Close');
});
it('an unclosed comment refuses edits rather than writing inside it', () => {
  expect(() => generate('Text\n\n%%\nhidden')).toThrow('comment');
  expect(() => generate('Text\n\n<!--\nhidden')).toThrow('comment');
  const closed = 'Text\n\n%%\nhidden\n%%\n';
  expect(generate(closed)).toContain('## 2026-05-27');
});
it('disabled generation returns untouched content even with ambiguity', () => expect(generateDays('## duplicate', '', '', { ...config, enabled: false })).toBe('## duplicate'));
it('custom heading levels, locale dates and CRLF retained', () => {
  const body = '### 27.05.2026\r\nKeep\r\n';
  expect(generateDays(body, '2026-05-27', '2026-05-27', {
    ...config,
    headingLevel: 3,
    activityLevel: 4,
    activityHeading: 'Visits',
    dateFormat: 'DD.MM.YYYY',
  })).toBe(`${body}\r\n#### Visits\r\n\r\n`);
});
it('day headings can use any readable Moment format, and are recognised in it again', () => {
  const named = { ...config, dateFormat: 'dddd, D MMMM YYYY' };
  const once = generateDays('', '2026-05-27', '2026-05-28', named);
  expect(once).toBe('## Wednesday, 27 May 2026\n\n### Activities\n\n## Thursday, 28 May 2026\n\n### Activities\n\n');
  expect(generateDays(once, '2026-05-27', '2026-05-28', named)).toBe(once);
});
