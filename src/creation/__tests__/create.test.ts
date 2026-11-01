import type { CreationDraft, ParentNote } from '../create';
import { expect, it } from 'vitest';
import { newType } from '../../config/profile';
import { parseProperties, splitNote } from '../../config/template-render';
import { TestVault } from '../../editing/test-vault';
import { parseFields } from '../../ui/creation/fields';
import { applyCreation, prepareNote, previewCreation } from '../create';

function setup() {
  const io = new TestVault();
  const type = newType('trip');
  const parent: ParentNote = {
    path: 'Travel/Trip.md',
    content: io.note({ startDate: '2026-05-20', endDate: '2026-05-30' }),
    type,
  };
  io.files.set(parent.path, parent.content);
  const child = newType('planning', 'entry');
  child.minimalBody = 'Prose';
  const draft: CreationDraft = {
    type: child,
    name: 'Stop',
    start: '2026-05-27',
    end: '2026-05-28',
    fields: {},
    parent,
  };
  return { io, parent, draft };
}
it('parent range gates block, explicit repair restores creation', async () => {
  const { io, draft, parent } = setup();
  for (const dates of [
    {},
    { startDate: 42 },
    { startDate: '2026-05-30', endDate: '2026-05-20' },
  ]) {
    parent.content = io.note(dates);
    io.files.set(parent.path, parent.content);
    await expect(previewCreation(io, [draft])).rejects.toThrow('Parent trip');
    expect(io.writes).toEqual([]);
  }
  parent.content = io.note({ startDate: '2026-05-20', endDate: '2026-05-30' });
  io.files.set(parent.path, parent.content);
  const result = await applyCreation(io, await previewCreation(io, [draft]));
  expect(result.completed).toEqual(['Travel/Stop.md']);
});
it('out of range, invalid names and collision never write', async () => {
  const { io, draft } = setup();
  await expect(previewCreation(io, [
    { ...draft, end: '2026-05-31' },
  ])).rejects.toThrow('outside');
  await expect(previewCreation(io, [
    { ...draft, name: '../escape' },
  ])).rejects.toThrow();
  io.files.set('Travel/Stop.md', 'Keep');
  await expect(previewCreation(io, [draft])).rejects.toThrow('exists');
  expect(io.files.get('Travel/Stop.md')).toBe('Keep');
  expect(io.writes).toEqual([]);
});
it('custom semantic keys and full-path parent/Base links', async () => {
  const { io, draft, parent } = setup();
  parent.type.mappings = {
    start: 'begins',
    end: 'finishes',
    parent: '',
    activities: 'visits',
  };
  parent.content = io.note({ begins: '2026-05-20', finishes: '2026-05-30' });
  io.files.set(parent.path, parent.content);
  draft.type.mappings = { ...parent.type.mappings, parent: 'journey' };
  draft.type.basePath = 'Templates/Stops.base';
  io.files.set(draft.type.basePath, 'views: []');
  draft.type.pathPattern = 'Trips/{{trip_start_year}}/{{trip_name}}/{{entry_name}}.md';
  const plan = await previewCreation(io, [draft]);
  expect(plan.files[0]?.path).toBe('Trips/2026/Trip/Stop.md');
  const properties = parseProperties(splitNote(plan.files[0]?.content ?? '').yaml, io.codec);
  expect(properties).toMatchObject({
    begins: draft.start,
    finishes: draft.end,
    journey: '[[Travel/Trip.md]]',
    base: '[[Templates/Stops.base]]',
  });
});
it('d21 abort before writes or folders and draft retained for corrected retry', async () => {
  const { io, draft } = setup();
  draft.type.days.enabled = true;
  draft.type.days.dateFormat = 'YYYY-MM-DD';
  draft.type.minimalBody = '## 2026-05-27\n## 2026-05-27\n';
  await expect(previewCreation(io, [draft])).rejects.toThrow('Duplicate');
  expect(io.writes).toEqual([]);
  expect(draft.name).toBe('Stop');
  draft.type.minimalBody = '## 2026-05-27\nKeep this\n';
  const plan = await previewCreation(io, [draft]);
  expect(plan.files[0]?.content).toContain('Keep this\n\n### Activities');
});
it('trip-first batch and honest partial report; no blind retry', async () => {
  const { io, draft } = setup();
  const trip: CreationDraft = {
    ...draft,
    type: newType('new-trip'),
    name: 'New trip',
    parent: undefined,
    start: '2026-05-20',
    end: '2026-05-30',
  };
  const prepared = prepareNote(trip, '', io.codec);
  draft.parent = { ...prepared, type: trip.type };
  const plan = await previewCreation(io, [draft, trip]);
  expect(plan.files.map(file => file.path)).toEqual(['Travel/New trip.md', 'Travel/Stop.md']);
  io.failPath = 'Travel/Stop.md';
  expect(await applyCreation(io, plan)).toMatchObject({
    completed: ['Travel/New trip.md'],
    failed: 'Travel/Stop.md',
    untouched: [],
  });
  expect((await applyCreation(io, plan)).completed).toEqual([]);
});
it('a parent changed after preview stops creation', async () => {
  const { io, draft, parent } = setup();
  const plan = await previewCreation(io, [draft]);
  io.files.set(parent.path, `${parent.content}external change`);
  expect(await applyCreation(io, plan)).toMatchObject({ completed: [], failed: 'Travel/Stop.md' });
  expect(io.writes).toEqual([]);
});
it('a template changed after preview stops creation', async () => {
  const { io, draft } = setup();
  draft.type.template = '_templates/Planning.md';
  io.files.set(draft.type.template, 'Template prose\n');
  const plan = await previewCreation(io, [draft]);
  io.files.set(draft.type.template, 'Edited template\n');
  expect((await applyCreation(io, plan)).completed).toEqual([]);
  expect(io.exists('Travel/Stop.md')).toBe(false);
  expect(io.writes).toEqual([]);
});
it('optional template fields render empty and defaults render consistently', async () => {
  const { io, draft } = setup();
  draft.type.fields = [
    {
      key: 'extra',
      label: 'Extra',
      type: 'text',
      required: false,
    },
    {
      key: 'amount',
      label: 'Amount',
      type: 'number',
      required: false,
      defaultValue: 7,
    },
  ];
  draft.type.minimalBody = '{{extra}} {{amount}}';
  const plan = await previewCreation(io, [draft]);
  expect(splitNote(plan.files[0]?.content ?? '').body).toBe(' 7');
  const cleared = await previewCreation(io, [
    {
      ...draft,
      fields: parseFields(draft.type.fields, { extra: '', amount: '' }),
    },
  ]);
  expect(splitNote(cleared.files[0]?.content ?? '').body).toBe(' ');
  expect(parseProperties(splitNote(cleared.files[0]?.content ?? '').yaml, io.codec)).toMatchObject({ amount: null });
  io.files.set('T.md', '---\n{"amount": 7}\n---\n');
  draft.type.template = 'T.md';
  const literal = await previewCreation(io, [
    {
      ...draft,
      fields: parseFields(draft.type.fields, { amount: '' }),
    },
  ]);
  expect(parseProperties(splitNote(literal.files[0]?.content ?? '').yaml, io.codec)).toMatchObject({ amount: null });
});
it('undated trip missing year requires explicit destination', async () => {
  const { io } = setup();
  const type = newType('undated');
  type.dated = false;
  type.pathPattern = 'Travel/{{trip_start_year}}/{{trip_name}}.md';
  const draft = { type, name: 'New', fields: {} };
  await expect(previewCreation(io, [draft])).rejects.toThrow('explicit destination');
  expect((await previewCreation(io, [
    { ...draft, destination: 'Travel/New.md' },
  ])).files[0]?.path).toBe('Travel/New.md');
});
it('short parent link and starting activities are written as plain links', async () => {
  const { io, draft } = setup();
  const plan = await previewCreation(io, [
    {
      ...draft,
      parentLink: 'Trip',
      activities: [
        { link: 'Dongbaek Park' },
        { link: 'Gwangalli Beach' },
      ],
    },
  ]);
  const properties = parseProperties(splitNote(plan.files[0]?.content ?? '').yaml, io.codec);
  expect(properties.backlink).toBe('[[Trip]]');
  expect(properties.Activities).toEqual(['[[Dongbaek Park]]', '[[Gwangalli Beach]]']);
});
it('activities given a day are listed under that day; the rest only in the activity list', async () => {
  const { io, draft } = setup();
  draft.type.days.enabled = true;
  const plan = await previewCreation(io, [
    {
      ...draft,
      activities: [
        { link: 'Dongbaek Park', day: '2026-05-28' },
        { link: 'Gwangalli Beach' },
      ],
    },
  ]);
  const content = plan.files[0]?.content ?? '';
  expect(parseProperties(splitNote(content).yaml, io.codec).Activities).toEqual(['[[Dongbaek Park]]', '[[Gwangalli Beach]]']);
  const body = splitNote(content).body;
  expect(body).toContain('## 2026-05-28\n\n### Activities\n\n- [[Dongbaek Park]]\n');
  expect(body.match(/Dongbaek Park/g)).toHaveLength(1);
  expect(body).not.toContain('Gwangalli');
  // A day outside the entry is refused rather than silently dropped.
  await expect(previewCreation(io, [
    {
      ...draft,
      activities: [
        { link: 'Dongbaek Park', day: '2026-05-29' },
      ],
    },
  ])).rejects.toThrow('within the entry');
});
