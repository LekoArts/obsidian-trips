import type { RecognizedNote } from '../../types';
import { expect, it } from 'vitest';
import { noteName } from '../../config/paths';
import { presetProfile } from '../../config/profile';
import { TestVault } from '../../editing/test-vault';
import { applyCreation, previewCreation } from '../create';
import { buildDraft } from '../draft';

const trip = 'Travel/2026/Lisbon/Lisbon.md';
const tripNote = '---\n{"base":"[[_templates/Bases/Travel.base]]","startDate":"2026-09-10","endDate":"2026-09-13"}\n---\n';
const dayPlan = 'Travel/2026/Lisbon/Planning/Belem.md';

function setup() {
  const io = new TestVault();
  io.files.set('_templates/Travel_Advanced.md', '# Notes\n');
  io.files.set('_templates/Planning.md', 'Plan\n');
  for (const base of ['Travel', 'Planning', 'Activities']) io.files.set(`_templates/Bases/${base}.base`, 'views: []');
  const types = presetProfile().types;
  const note = (path: string, typeId: string, parentPath?: string): RecognizedNote => ({
    path,
    candidates: [typeId],
    typeId,
    parentCandidates: [],
    parentPath,
    diagnostics: [],
  });
  const context = {
    io,
    index: [
      note(trip, 'advanced'),
      note(dayPlan, 'planning', trip),
    ],
    types,
    linkText: (path: string) => noteName(path),
  };
  const type = (id: string) => types.find(item => item.id === id)!;
  return { io, context, type };
}

async function create(io: TestVault, draft: Parameters<typeof previewCreation>[1][number]) {
  return applyCreation(io, await previewCreation(io, [draft]));
}

it('builds a trip the way the form does, with omitted fields defaulted and parsed lists', async () => {
  const { io, context, type } = setup();
  const draft = await buildDraft({
    type: type('advanced'),
    name: 'Lisbon',
    start: '2026-09-10',
    end: '2026-09-13',
    fields: { Persons: 'Ana\nBo' },
  }, context);
  expect((await create(io, draft)).completed).toEqual([trip]);
  expect(io.files.get(trip)).toBe('---\n{"Persons":["Ana","Bo"],"Done":false,"banner":null,"base":"[[_templates/Bases/Travel.base]]","startDate":"2026-09-10","endDate":"2026-09-13"}\n---\n# Notes\n');
});

it('builds a day plan under its trip with an activity listed under its day', async () => {
  const { io, context, type } = setup();
  io.files.set(trip, tripNote);
  const draft = await buildDraft({
    type: type('planning'),
    name: 'Alfama',
    start: '2026-09-11',
    end: '2026-09-12',
    fields: {},
    parentPath: trip,
    activities: [
      { link: 'Tram 28', day: '2026-09-11' },
    ],
  }, context);
  expect((await create(io, draft)).completed).toEqual(['Travel/2026/Lisbon/Planning/Alfama.md']);
  expect(io.files.get('Travel/2026/Lisbon/Planning/Alfama.md')).toBe([
    '---',
    '{"base":"[[_templates/Bases/Planning.base]]","backlink":"[[Lisbon]]","Activities":["[[Tram 28]]"],"startDate":"2026-09-11","endDate":"2026-09-12"}',
    '---',
    'Plan',
    '',
    '## 2026-09-11',
    '',
    '### Activities',
    '',
    '- [[Tram 28]]',
    '',
    '## 2026-09-12',
    '',
    '### Activities',
    '',
    '',
  ].join('\n'));
});

it('refuses a parent that is not a recognized trip, before anything is written', async () => {
  const { io, context, type } = setup();
  io.files.set(trip, tripNote);
  io.files.set(dayPlan, 'Keep');
  const files = new Map(io.files);
  const child = {
    type: type('activity'),
    name: 'Tram 28',
    fields: {},
  };
  await expect(buildDraft({ ...child, parentPath: 'Travel/Unknown.md' }, context)).rejects.toThrow('The trip needs attention first');
  await expect(buildDraft({ ...child, parentPath: dayPlan }, context)).rejects.toThrow('Choose a trip');
  context.index[0]!.diagnostics.push({ path: trip, message: 'Ambiguous', capability: 'recognition' });
  await expect(buildDraft({ ...child, parentPath: trip }, context)).rejects.toThrow('The trip needs attention first');
  expect(io.writes).toEqual([]);
  expect(io.files).toEqual(files);
});
