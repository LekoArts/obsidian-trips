import type { BatchStep } from '../batch';
import { expect, it } from 'vitest';
import { parseProperties, splitNote } from '../../config/template-render';
import { applyBatch, batchPlan, undoPlan } from '../batch';
import { TestVault } from '../test-vault';

function setup() {
  const io = new TestVault();
  const steps: BatchStep[] = ['A', 'B', 'C'].map((path) => {
    const before = {
      path,
      content: io.note({ start: '2026-05-27' }),
    };
    io.files.set(path, before.content);
    return {
      before,
      kind: 'properties',
      changes: { start: '2026-05-28' },
      summary: 'Move by one day',
    };
  });
  return {
    io,
    plan: batchPlan(steps),
  };
}
const starts = async (io: TestVault, paths = ['A', 'B', 'C']) => Promise.all(paths.map(async path => parseProperties(splitNote(await io.read(path)).yaml, io.codec).start));
it('fault injection stops at first failure with honest report and idempotent retry', async () => {
  const { io, plan } = setup();
  io.failPath = 'B';
  expect(await applyBatch(io, plan)).toMatchObject({
    completed: ['A'],
    failed: 'B',
    untouched: ['C'],
  });
  expect(io.writes).toEqual(['A']);
  expect(splitNote(await io.read('A')).body).toBe(splitNote(plan.steps[0]!.before.content).body);
  expect(await starts(io)).toEqual(['2026-05-28', '2026-05-27', '2026-05-27']);
  io.failPath = undefined;
  expect(await applyBatch(io, plan)).toEqual({
    completed: ['A', 'B', 'C'],
    untouched: [],
  });
  await applyBatch(io, plan);
  expect(io.writes).toEqual(['A', 'B', 'C']);
  expect(await starts(io)).toEqual(['2026-05-28', '2026-05-28', '2026-05-28']);
});
it('successful write with failed verification read is reported completed and never replayed', async () => {
  const { io, plan } = setup();
  const read = io.read.bind(io);
  io.read = async path => path === 'A' && io.writes.includes('A')
    ? Promise.reject(new Error('Read failed'))
    : read(path);
  expect(await applyBatch(io, plan)).toMatchObject({
    completed: ['A'],
    failed: 'A',
    untouched: ['B', 'C'],
  });
  io.read = read;
  expect((await applyBatch(io, plan)).error).toContain('couldn\'t be confirmed');
  expect(io.writes).toEqual(['A']);
});
it('preflight conflict in later file causes zero writes', async () => {
  const { io, plan } = setup();
  io.files.set('C', 'External change');
  expect(await applyBatch(io, plan)).toMatchObject({
    completed: [],
    failed: 'C',
    untouched: ['A', 'B'],
  });
  expect(io.writes).toEqual([]);
});
it('changed completed file blocks retry without rollback', async () => {
  const { io, plan } = setup();
  io.failPath = 'B';
  await applyBatch(io, plan);
  io.files.set('A', 'External change');
  io.failPath = undefined;
  expect((await applyBatch(io, plan)).failed).toBe('A');
  expect(await io.read('A')).toBe('External change');
  expect(io.writes).toEqual(['A']);
});
it('unsaved editor and changed source snapshots prevent a batch', async () => {
  const { io, plan } = setup();
  io.editors.set('B', ['Unsaved']);
  expect((await applyBatch(io, plan)).failed).toBe('B');
  expect(io.writes).toEqual([]);
  io.editors.clear();
  plan.sources.push({ path: 'Trip', content: 'old' });
  io.files.set('Trip', 'new');
  expect((await applyBatch(io, plan)).failed).toBe('Trip');
  expect(io.writes).toEqual([]);
});
it('a content edit writes exactly the planned note', async () => {
  const { io } = setup();
  const before = { path: 'A', content: await io.read('A') };
  const after = io.note({
    start: '2026-05-27',
    activities: ['[[Tram]]'],
  }, '## 2026-05-27\n### Activities\n- [[Tram]]\n');
  await applyBatch(io, batchPlan([
    {
      before,
      kind: 'content',
      after,
      summary: 'Assignment',
    },
  ]));
  expect(io.writes).toEqual(['A']);
  expect(await io.read('A')).toBe(after);
});
it('mixed content, trash and property batch: retry neither rewrites nor trashes twice', async () => {
  const io = new TestVault();
  for (const path of ['Entry', 'Old', 'Late']) io.files.set(path, io.note({ start: '2026-05-27' }));
  const snap = async (path: string) => ({ path, content: await io.read(path) });
  const after = io.note({ start: '2026-05-27' }, 'Authored prose {{date}}\n- [[Tram]]\n');
  const plan = batchPlan([
    {
      before: await snap('Entry'),
      kind: 'content',
      after,
      summary: 'Assign',
    },
    { before: await snap('Old'), kind: 'trash', summary: 'Trash' },
    {
      before: await snap('Late'),
      kind: 'properties',
      changes: { start: '2026-05-28' },
      summary: 'Move',
    },
  ]);
  io.failPath = 'Late';
  expect(await applyBatch(io, plan)).toMatchObject({
    completed: ['Entry', 'Old'],
    failed: 'Late',
  });
  expect(io.exists('Old')).toBe(false);
  io.failPath = undefined;
  expect(await applyBatch(io, plan)).toEqual({
    completed: ['Entry', 'Old', 'Late'],
    untouched: [],
  });
  expect(io.writes).toEqual(['Entry', 'Old', 'Late']);
  expect(await io.read('Entry')).toBe(after);
});
it('a recreated trashed path blocks retry and is left alone', async () => {
  const io = new TestVault();
  for (const path of ['Old', 'Late']) io.files.set(path, io.note({ start: '2026-05-27' }));
  const plan = batchPlan([
    {
      before: { path: 'Old', content: await io.read('Old') },
      kind: 'trash',
      summary: 'Trash',
    },
    {
      before: { path: 'Late', content: await io.read('Late') },
      kind: 'properties',
      changes: { start: '2026-05-28' },
      summary: 'Move',
    },
  ]);
  io.failPath = 'Late';
  await applyBatch(io, plan);
  io.files.set('Old', 'A new note with the same name');
  io.failPath = undefined;
  expect((await applyBatch(io, plan)).failed).toBe('Old');
  expect(await io.read('Old')).toBe('A new note with the same name');
  expect(io.writes).toEqual(['Old']);
});

it('an edit that lands between a write and its read-back is never adopted: Undo and Retry refuse instead of erasing it', async () => {
  for (const kind of ['body', 'property'] as const) {
    const { io, plan } = setup();
    const write = io.updateProperties.bind(io);
    io.updateProperties = async (expected, update) => {
      await write(expected, update);
      if (expected.path === 'B') {
        const now = io.files.get('B')!;
        io.files.set('B', kind === 'body'
          ? `${now}typed meanwhile\n`
          : now.replace('"2026-05-28"', '"2026-06-01"'));
      }
    };
    const report = await applyBatch(io, plan);
    expect(report.completed).toEqual(['A', 'B']);
    expect(report.failed).toBe('B');
    const external = io.files.get('B');
    expect(() => undoPlan(plan)).toThrow(/B changed while it was being written/);
    io.updateProperties = write;
    expect((await applyBatch(io, plan)).failed).toBe('B');
    expect(io.files.get('B')).toBe(external);
    expect(io.files.get('C')).toBe(plan.steps[2]!.before.content);
  }
});
it('a failed trash leaves that note and everything after it alone; retry finishes with the planned values', async () => {
  const io = new TestVault();
  for (const path of ['Entry', 'Old', 'Late']) io.files.set(path, io.note({ start: '2026-05-27' }));
  const snap = async (path: string) => ({ path, content: await io.read(path) });
  const old = await snap('Old');
  const late = await snap('Late');
  const after = io.note({ start: '2026-05-27' }, 'Authored prose {{date}}\n- [[Tram]]\n');
  const plan = batchPlan([
    {
      before: await snap('Entry'),
      kind: 'content',
      after,
      summary: 'Assign',
    },
    { before: old, kind: 'trash', summary: 'Trash' },
    {
      before: late,
      kind: 'properties',
      changes: { start: '2026-05-28' },
      summary: 'Move',
    },
  ]);
  io.failPath = 'Old';
  expect(await applyBatch(io, plan)).toMatchObject({
    completed: ['Entry'],
    failed: 'Old',
    untouched: ['Late'],
  });
  expect(await io.read('Old')).toBe(old.content);
  expect(await io.read('Late')).toBe(late.content);
  io.failPath = undefined;
  expect(await applyBatch(io, plan)).toEqual({
    completed: ['Entry', 'Old', 'Late'],
    untouched: [],
  });
  expect(io.exists('Old')).toBe(false);
  expect(await starts(io, ['Late'])).toEqual(['2026-05-28']);
  expect(splitNote(await io.read('Late')).body).toBe(splitNote(late.content).body);
});
it('a source note changed after the first write stops the batch before the next one', async () => {
  const { io, plan } = setup();
  io.files.set('Trip', 'trip');
  plan.sources.push({ path: 'Trip', content: 'trip' });
  const update = io.updateProperties.bind(io);
  io.updateProperties = async (expected, change) => {
    await update(expected, change);
    if (expected.path === 'A')
      io.files.set('Trip', 'trip, edited meanwhile');
  };
  expect(await applyBatch(io, plan)).toMatchObject({
    completed: ['A'],
    failed: 'Trip',
    untouched: ['B', 'C'],
  });
  expect(io.writes).toEqual(['A']);
});
it('a file this plan already wrote must still hold its receipt before the next write', async () => {
  const { io, plan } = setup();
  plan.sources = [];
  const update = io.updateProperties.bind(io);
  io.updateProperties = async (expected, change) => {
    await update(expected, change);
    if (expected.path === 'A')
      io.files.set('A', `${io.files.get('A')} edited meanwhile`);
  };
  expect(await applyBatch(io, plan)).toMatchObject({
    completed: ['A'],
    failed: 'A',
    untouched: ['B', 'C'],
  });
  expect(io.writes).toEqual(['A']);
});
it('declining the delete prompt writes nothing more and is not a failure', async () => {
  const io = new TestVault();
  io.files.set('A.md', 'a');
  io.files.set('B.md', 'b');
  io.confirmDelete = false;
  const plan = batchPlan([
    {
      before: { path: 'A.md', content: 'a' },
      kind: 'trash',
      summary: '',
    },
    {
      before: { path: 'B.md', content: 'b' },
      kind: 'content',
      after: 'B',
      summary: '',
    },
  ]);
  expect(await applyBatch(io, plan)).toEqual({
    completed: [],
    untouched: ['A.md', 'B.md'],
    cancelled: true,
  });
  expect([
    io.files.get('A.md'),
    io.files.get('B.md'),
  ]).toEqual(['a', 'b']);
});
