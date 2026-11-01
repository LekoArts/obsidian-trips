import type { AssignmentRequest } from '../assignments';
import { expect, it } from 'vitest';
import { newType } from '../../config/profile';
import { dailyOccurrences, previewAssignment } from '../assignments';

const config = {
  ...newType('entry').days,
  enabled: true,
  dateFormat: 'YYYY-MM-DD' as const,
};
const range = { start: '2026-05-27', end: '2026-05-30' };
function resolve(link: string) {
  return /\[\[(?:Activity|Activities\/A.md)(?:\|[^\]]+)?\]\]/.test(link)
    ? 'Activities/A.md'
    : undefined;
}
const target = 'Activities/A.md';
const source = 'Intro [[Activity]]\n\n## 2026-05-27\nProse\n### Activities\n- [[Activity]]\n### Notes\nKeep\n## 2026-05-28\n### Activities\n- [[Activity|Alias]]\n';
const preview = (body: string, membership: unknown, request: AssignmentRequest) => previewAssignment(body, membership, config, range, request, resolve);
it('general add changes membership only, even with unsupported body', () => {
  const result = preview('```\nUnclosed', [], { action: 'general-add', target });
  expect(result.body).toBe('```\nUnclosed');
  expect(result.membership).toEqual(['[[Activities/A.md]]']);
});
// An unrelated activity sits in the same Activities lists; only the target's bullets may go.
const mixed = 'Intro [[Activity]]\n\n## 2026-05-27\nProse\n### Activities\n- [[Other]]\n- [[Activity]]\n### Notes\nKeep [[Activity]]\n## 2026-05-28\n### Activities\n- [[Activity|Alias]]\n- [[Other]]\n';
it('per-day removal deletes only that day’s bullet and keeps the activity a member', () => {
  const first = preview(mixed, ['[[Activity]]'], { action: 'day-remove', day: '2026-05-27', target });
  expect(first.body).toBe('Intro [[Activity]]\n\n## 2026-05-27\nProse\n### Activities\n- [[Other]]\n### Notes\nKeep [[Activity]]\n## 2026-05-28\n### Activities\n- [[Activity|Alias]]\n- [[Other]]\n');
  expect(first.membership).toEqual(['[[Activity]]']);
  const last = preview(first.body, first.membership, { action: 'day-remove', day: '2026-05-28', target });
  expect(last.body).toBe('Intro [[Activity]]\n\n## 2026-05-27\nProse\n### Activities\n- [[Other]]\n### Notes\nKeep [[Activity]]\n## 2026-05-28\n### Activities\n- [[Other]]\n');
  expect(last.membership).toEqual(['[[Activity]]']);
});
it('full removal deletes every daily bullet of the target and its membership, nothing else', () => {
  const result = preview(mixed, ['[[Activity]]', '[[Other]]'], { action: 'full-remove', target });
  expect(result.occurrences.map(item => item.date)).toEqual(['2026-05-27', '2026-05-28']);
  expect(result.membership).toEqual(['[[Other]]']);
  expect(result.body).toBe('Intro [[Activity]]\n\n## 2026-05-27\nProse\n### Activities\n- [[Other]]\n### Notes\nKeep [[Activity]]\n## 2026-05-28\n### Activities\n- [[Other]]\n');
});
it('a new bullet goes after the last activity and keeps the blank line before the next day', () => {
  const empty = '## 2026-05-27\n\n### Activities\n\n## 2026-05-28\n\n### Activities\n\n- [[B]]\n\n## Notes\n';
  const first = preview(empty, [], {
    action: 'day-add',
    target,
    day: '2026-05-27',
    linkText: 'Activity',
  });
  expect(first.body).toBe('## 2026-05-27\n\n### Activities\n\n- [[Activity]]\n\n## 2026-05-28\n\n### Activities\n\n- [[B]]\n\n## Notes\n');
  const second = preview(first.body, first.membership, {
    action: 'day-add',
    target,
    day: '2026-05-28',
    linkText: 'Activity',
  });
  expect(second.body).toBe('## 2026-05-27\n\n### Activities\n\n- [[Activity]]\n\n## 2026-05-28\n\n### Activities\n\n- [[B]]\n- [[Activity]]\n\n## Notes\n');
  expect(second.membership).toEqual(['[[Activity]]']);
});
it('removing the bullet just added restores the note byte for byte', () => {
  const original = '## 2026-05-27\n\n### Activities\n\n## 2026-05-28\n\n### Activities\n\n- [[B]]\n- [[Activity]]\n\n## Notes\n';
  const added = preview(original, [], {
    action: 'day-add',
    target,
    day: '2026-05-27',
    linkText: 'Activity',
  });
  expect(preview(added.body, added.membership, { action: 'day-remove', target, day: '2026-05-27' }).body).toBe(original);
  const later = preview(original, [], { action: 'day-remove', target, day: '2026-05-28' }).body;
  expect(later).toBe('## 2026-05-27\n\n### Activities\n\n## 2026-05-28\n\n### Activities\n\n- [[B]]\n\n## Notes\n');
});
it('adding an activity that is already a member keeps the membership order', () => {
  const body = '## 2026-05-27\n\n### Activities\n\n';
  const result = preview(body, ['[[Activity]]', '[[Other]]'], {
    action: 'day-add',
    target,
    day: '2026-05-27',
    linkText: 'Activity',
  });
  expect(result.membership).toEqual(['[[Activity]]', '[[Other]]']);
});
it('a membership with duplicates of the target keeps only its first place', () => {
  const body = '## 2026-05-27\n\n### Activities\n\n';
  const result = preview(body, ['[[Other]]', '[[Activity]]', '[[Activities/A.md]]'], {
    action: 'day-add',
    target,
    day: '2026-05-27',
    linkText: 'Activity',
  });
  expect(result.membership).toEqual(['[[Other]]', '[[Activity]]']);
});
it('a day that ends inside a comment is not given a hidden bullet', () => {
  const body = '## 2026-05-27\n\n### Activities\n\n%%\nhidden text\n';
  expect(() => preview(body, [], { action: 'day-add', target, day: '2026-05-27' })).toThrow('comment');
  const closed = '## 2026-05-27\n\n### Activities\n\n%%\nhidden text\n%%\n';
  expect(preview(closed, [], { action: 'day-add', target, day: '2026-05-27' }).body).toBe(`## 2026-05-27\n\n### Activities\n\n%%\nhidden text\n%%\n- [[Activities/A.md]]\n`);
});
it('a missing Activities section is added under the day, and adding again changes nothing', () => {
  const original = 'Intro\r\n## 2026-05-27\r\nKeep prose\r\n## Footer\r\nLeave me\r\n';
  const result = preview(original, [], { action: 'day-add', target, day: '2026-05-27' });
  expect(result.addedSection).toBe(true);
  expect(result.body).toContain('Keep prose\r\n\r\n### Activities\r\n\r\n- [[Activities/A.md]]\r\n\r\n## Footer\r\nLeave me\r\n');
  expect(preview(result.body, result.membership, { action: 'day-add', target, day: '2026-05-27' }).body).toBe(result.body);
});
it('missing day append and reassign preserve membership and unrelated bytes', () => {
  const result = preview(source, [], {
    action: 'reassign',
    fromDay: '2026-05-27',
    day: '2026-05-30',
    target,
  });
  expect(dailyOccurrences(result.body, config).map(item => item.date)).toEqual(['2026-05-28', '2026-05-30']);
  expect(result.membership).toEqual(['[[Activities/A.md]]']);
  expect(result.body).toContain('### Notes\nKeep\n');
});
it('duplicate date/activity sections reject; fenced-code links and headings ignored', () => {
  expect(() => preview(`${source}## 2026-05-27\n`, [], { action: 'full-remove', target })).toThrow('Duplicate');
  expect(() => preview('## 2026-05-27\n### Activities\n### Activities\n', [], { action: 'full-remove', target })).toThrow('Duplicate');
  const fenced = `${source}\`\`\`md\n## 2026-05-27\n- [[Activity]]\n\`\`\`\n`;
  const result = preview(fenced, [], { action: 'full-remove', target });
  expect(result.occurrences).toHaveLength(2);
  expect(result.body).toContain('```md\n## 2026-05-27\n- [[Activity]]\n```');
});
it('stale daily links remain visible independent of rescheduled property range', () => {
  expect(dailyOccurrences(source, config).map(item => item.date)).toEqual(['2026-05-27', '2026-05-28']);
  const result = previewAssignment(source, [], config, { start: '2026-06-01', end: '2026-06-04' }, { action: 'day-remove', day: '2026-05-27', target }, resolve);
  expect(dailyOccurrences(result.body, config)[0]?.date).toBe('2026-05-28');
});
it('wrong-shaped membership, unresolved targets and out-of-range additions reject', () => {
  expect(() => preview(source, '[[Activity]]', { action: 'day-add', day: '2026-05-27', target })).toThrow('list');
  expect(() => preview(source, [], { action: 'day-add', day: '2026-05-26', target })).toThrow('range');
  expect(() => preview(source, [], { action: 'general-add', target: 'Missing.md' })).toThrow('ambiguous');
});
it('adding to a day that already has a list puts the bullet after its last one, before notes written under the list', () => {
  const body = '## 2026-05-27\n### Activities\n- [[Other]]\n\nBook ahead, opens at 9.\n## 2026-05-28\n';
  expect(preview(body, [], { action: 'day-add', day: '2026-05-27', target }).body).toBe('## 2026-05-27\n### Activities\n- [[Other]]\n- [[Activities/A.md]]\n\nBook ahead, opens at 9.\n## 2026-05-28\n');
});
it('commented-out bullets and headings are neither recognised nor removed', () => {
  const commented = '## 2026-05-27\n### Activities\n%%\n- [[Activity]]\n%%\n<!-- - [[Activity]] -->\n<!--\n## 2026-05-28\n- [[Activity]]\n-->\n- [[Activity]]\n';
  expect(dailyOccurrences(commented, config).map(item => [item.date, item.start])).toEqual([
    [
      '2026-05-27',
      commented.lastIndexOf('- [[Activity]]'),
    ],
  ]);
  const result = preview(commented, ['[[Activity]]'], { action: 'full-remove', target });
  expect(result.body).toBe(commented.slice(0, commented.lastIndexOf('- [[Activity]]')));
});
it('comment delimiters are read in order: one kind inside the other is just text', () => {
  const nested = '## 2026-05-27\n### Activities\n<!-- %% -->\n- [[Activity]]\n<!--\nx --> <!--\n- [[Activity]]\n-->\n';
  const visible = nested.indexOf('- [[Activity]]');
  expect(dailyOccurrences(nested, config).map(item => item.start)).toEqual([visible]);
});
it('comment delimiters inside inline code are code', () => {
  const body = 'Use `<!--` or ``%%`` to comment.\n\n## 2026-05-27\n### Activities\n- [[Activity]]\n';
  expect(dailyOccurrences(body, config).map(item => item.date)).toEqual(['2026-05-27']);
});
