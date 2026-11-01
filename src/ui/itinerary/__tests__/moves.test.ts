import type { TestVault } from '../../../editing/test-vault';
import { expect, it } from 'vitest';
import { parseProperties, splitNote } from '../../../config/template-render';
import { undoPlan } from '../../../editing/batch';
import { stepTarget } from '../layout';
import { applyPlan, movePlan } from '../operations';
import { loadTrip } from './fixture';

const day = (date: string, ...links: string[]) => `## ${date}\n### Activities\n${links.map(link => `- [[${link}]]\n`).join('')}`;
const members = (io: TestVault, path: string) => parseProperties(splitNote(io.files.get(path)!).yaml, io.codec).Activities;

it('moving to another entry leaves only that day when the activity is on another day of the old entry', async () => {
  const { io, host, model, row } = await loadTrip({
    Busan: [
      '2026-05-10',
      '2026-05-12',
      `Intro\n${day('2026-05-10', 'Park')}\n${day('2026-05-11', 'Park', 'Idea')}`,
      {
        Activities: ['[[Park]]', '[[Idea]]'],
      },
    ],
    Jeju: ['2026-05-12', '2026-05-14', `${day('2026-05-13')}`],
  });
  await applyPlan(host, model, movePlan(host, model, 'Travel/Park.md', row('Jeju'), '2026-05-13', {
    row: row('Busan'),
    date: '2026-05-10',
  }));
  expect(splitNote(io.files.get('Travel/Busan.md')!).body).toBe(`Intro\n${day('2026-05-10')}\n${day('2026-05-11', 'Park', 'Idea')}`);
  expect(members(io, 'Travel/Busan.md')).toEqual(['[[Park]]', '[[Idea]]']);
  expect(splitNote(io.files.get('Travel/Jeju.md')!).body).toBe(day('2026-05-13', 'Park'));
  expect(members(io, 'Travel/Jeju.md')).toEqual(['[[Park]]']);
});

it('moving its only occurrence out of an entry also takes it off that entry\'s activity list', async () => {
  const { io, host, model, row } = await loadTrip({
    Busan: [
      '2026-05-10',
      '2026-05-11',
      `${day('2026-05-10', 'Park', 'Idea')}`,
      {
        Activities: ['[[Park]]', '[[Idea]]'],
      },
    ],
    Jeju: ['2026-05-12', '2026-05-14'],
  });
  await applyPlan(host, model, movePlan(host, model, 'Travel/Park.md', row('Jeju'), '2026-05-12', {
    row: row('Busan'),
    date: '2026-05-10',
  }));
  expect(splitNote(io.files.get('Travel/Busan.md')!).body).toBe(day('2026-05-10', 'Idea'));
  expect(members(io, 'Travel/Busan.md')).toEqual(['[[Idea]]']);
});

it.each([
  [
    'forward to the end',
    'A',
    2,
    ['B', 'C', 'A'],
  ],
  [
    'into the middle',
    'C',
    1,
    ['A', 'C', 'B'],
  ],
  [
    'backward to the top',
    'B',
    0,
    ['B', 'A', 'C'],
  ],
] as const)('reordering %s rewrites only that day; other days and prose stay byte-identical', async (_, target, index, order) => {
  const other = `${day('2026-05-11', 'A', 'B')}Notes about the 11th\n`;
  const { io, host, reload } = await loadTrip({
    Busan: [
      '2026-05-10',
      '2026-05-11',
      `${day('2026-05-10', 'A', 'B', 'C')}\nProse\n${other}`,
      {
        Activities: ['[[A]]', '[[B]]', '[[C]]'],
      },
    ],
  });
  for (const name of ['A', 'B', 'C']) io.files.set(`Travel/${name}.md`, io.note({ kind: 'activity', backlink: '[[Travel/Trip.md]]' }));
  const { model, row } = await reload();
  await applyPlan(host, model, movePlan(host, model, `Travel/${target}.md`, row('Busan'), '2026-05-10', {
    row: row('Busan'),
    date: '2026-05-10',
  }, index));
  expect(splitNote(io.files.get('Travel/Busan.md')!).body).toBe(`${day('2026-05-10', ...order)}\nProse\n${other}`);
});

it('a cross-entry move that fails on its second file: Retry finishes it, Undo restores only what was written', async () => {
  const { io, host, model, row, reload } = await loadTrip({
    Busan: [
      '2026-05-10',
      '2026-05-11',
      day('2026-05-10', 'Park'),
      {
        Activities: ['[[Park]]'],
      },
    ],
    Jeju: [
      '2026-05-12',
      '2026-05-14',
      day('2026-05-12'),
    ],
  });
  const original = new Map(io.files);
  const plan = movePlan(host, model, 'Travel/Park.md', row('Jeju'), '2026-05-12', {
    row: row('Busan'),
    date: '2026-05-10',
  });
  io.failPath = 'Travel/Jeju.md';
  const report = await applyPlan(host, model, plan);
  expect(report).toMatchObject({
    completed: ['Travel/Busan.md'],
    failed: 'Travel/Jeju.md',
  });
  // In between, the activity is on no day: off Busan, not yet in Jeju.
  expect(splitNote(io.files.get('Travel/Busan.md')!).body).toBe(day('2026-05-10'));
  expect(io.files.get('Travel/Jeju.md')).toBe(original.get('Travel/Jeju.md'));

  // Undo of the partial change touches Busan only.
  const undone = undoPlan(plan);
  expect(undone.steps.map(step => step.before.path)).toEqual(['Travel/Busan.md']);
  io.failPath = undefined;
  await applyPlan(host, (await reload()).model, undone);
  expect(io.files).toEqual(original);

  // Retry instead: the same plan skips Busan (already written) and writes Jeju once.
  const next = await reload();
  const retried = movePlan(host, next.model, 'Travel/Park.md', next.row('Jeju'), '2026-05-12', {
    row: next.row('Busan'),
    date: '2026-05-10',
  });
  io.failPath = 'Travel/Jeju.md';
  await applyPlan(host, next.model, retried);
  io.failPath = undefined;
  io.writes = [];
  expect((await applyPlan(host, next.model, retried)).failed).toBeUndefined();
  expect(io.writes).toEqual(['Travel/Jeju.md']);
  expect(splitNote(io.files.get('Travel/Jeju.md')!).body).toBe(day('2026-05-12', 'Park'));
  expect(splitNote(io.files.get('Travel/Busan.md')!).body).toBe(day('2026-05-10'));
});

it('alt+Up/Down: within the day, then onto the next day of the same entry, then the entry that covers the next day', async () => {
  const { plan, row } = await loadTrip({
    Busan: ['2026-05-10', '2026-05-11', `${day('2026-05-10', 'Park', 'Idea')}`],
    Jeju: ['2026-05-11', '2026-05-12'],
  });
  const busan = row('Busan');
  const jeju = row('Jeju');
  expect(stepTarget(plan, busan, '2026-05-10', 0, 1)).toEqual({ date: '2026-05-10', row: busan, index: 1 });
  expect(stepTarget(plan, busan, '2026-05-10', 1, 1)).toEqual({ date: '2026-05-11', row: busan, index: 0 });
  expect(stepTarget(plan, busan, '2026-05-11', 0, 1)).toEqual({ date: '2026-05-12', row: jeju, index: 0 });
  // Going up lands at the end of the previous day.
  expect(stepTarget(plan, jeju, '2026-05-11', 0, -1)).toEqual({ date: '2026-05-10', row: busan, index: undefined });
});

function refusal(target: ReturnType<typeof stepTarget>) {
  return 'refused' in target
    ? target.refused
    : undefined;
}
it('alt+Up/Down refuses at the trip edge, onto an empty day, and from a day outside the trip', async () => {
  const { plan, row } = await loadTrip({
    First: ['2026-05-01', '2026-05-01'],
    Last: ['2026-05-31', '2026-05-31'],
    Mid: ['2026-05-10', '2026-05-10'],
  });
  expect(refusal(stepTarget(plan, row('First'), '2026-05-01', 0, -1))).toContain('trip starts');
  expect(refusal(stepTarget(plan, row('Last'), '2026-05-31', 0, 1))).toContain('trip ends');
  expect(refusal(stepTarget(plan, row('Mid'), '2026-05-10', 0, 1))).toContain('Nothing is planned');
  expect(refusal(stepTarget(plan, row('Mid'), '2026-06-03', 0, 1))).toContain('outside the trip');
});

it('an entry starting before the trip carries its name and controls on the trip\'s first day', async () => {
  const { plan } = await loadTrip({
    Early: ['2026-04-28', '2026-05-02'],
  });
  const slots = plan.days.slice(0, 2).map(d => d.slots[0]!);
  expect(slots.map(slot => ({ first: slot.first, head: slot.head }))).toEqual([
    { first: false, head: true },
    { first: false, head: false },
  ]);
});
