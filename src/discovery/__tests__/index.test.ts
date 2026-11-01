import type { DiscoveryIO } from '../../io/vault';
import type { NoteSnapshot, Profile } from '../../types';
import { expect, it } from 'vitest';
import { newType, presetProfile } from '../../config/profile';
import { buildIndex, resolveTargets } from '../index';

const trip = newType('trip');
const entry = newType('plan', 'entry');
const profile: Profile = {
  name: 'Custom',
  scopes: ['Trips'],
  types: [trip, entry],
};
const notes: NoteSnapshot[] = [
  {
    path: 'Trips/Coast.md',
    properties: { kind: 'trip', startDate: '2026-05-01', endDate: '2026-05-05' },
  },
  {
    path: 'Trips/Day.md',
    properties: {
      kind: 'plan',
      backlink: '[[Coast]]',
      startDate: '2026-05-02',
      endDate: '2026-05-03',
      Activities: [],
    },
  },
  {
    path: 'Elsewhere/Outside.md',
    properties: { kind: 'trip' },
  },
];
const io: DiscoveryIO = {
  snapshots: () => structuredClone(notes),
  paths: () => notes.map(n => n.path),
};
it('recognizes custom mappings and resolves parent identity without writes', () => {
  const input = io.snapshots();
  const before = structuredClone(input);
  const result = buildIndex(profile, input, io.paths());
  expect(result).toHaveLength(2);
  expect(result.find(n => n.path === 'Trips/Day.md')).toMatchObject({ typeId: 'plan', parentPath: 'Trips/Coast.md', diagnostics: [] });
  expect(input).toEqual(before);
});
it('ambiguity stays blocked until explicit choice, without source edits', () => {
  const ambiguous = {
    ...profile,
    types: [
      ...profile.types,
      { ...trip, id: 'other' },
    ],
  };
  const result = buildIndex(ambiguous, notes, io.paths());
  const recognized = result.find(n => n.path === 'Trips/Coast.md');
  if (!recognized)
    throw new Error('fixture');
  expect(recognized.typeId).toBeUndefined();
  expect(buildIndex(ambiguous, notes, io.paths(), {
    'Trips/Coast.md': { typeId: 'other' },
  })[0]?.typeId).toBe('other');
});
it('wrong-typed properties diagnose only dependent operations', () => {
  const wrong = structuredClone(notes);
  const day = wrong[1];
  if (!day)
    throw new Error('fixture');
  day.properties.Activities = 'not a list';
  const result = buildIndex(profile, wrong, io.paths()).find(n => n.path === day.path);
  if (!result)
    throw new Error('fixture');
  expect(result.diagnostics.map(d => d.capability)).toEqual(['activities']);
});
it('wrong recognition shape is visible', () => {
  expect(buildIndex(profile, [
    {
      path: 'Trips/Bad.md',
      properties: {
        kind: ['trip'],
      },
    },
  ], [])[0]?.diagnostics[0]?.capability).toBe('recognition');
});
it('same-named parents require explicit target, outside-scope parent is not adopted', () => {
  const duplicate = [
    ...notes,
    { ...notes[0], path: 'Trips/Other/Coast.md', properties: notes[0]?.properties ?? {} },
  ];
  const result = buildIndex(profile, duplicate, duplicate.map(n => n.path));
  expect(result.find(n => n.path === 'Trips/Day.md')?.parentCandidates).toHaveLength(2);
  const resolved = buildIndex(profile, duplicate, duplicate.map(n => n.path), {
    'Trips/Day.md': { typeId: 'plan', parentPath: 'Trips/Other/Coast.md' },
  });
  expect(resolved.find(n => n.path === 'Trips/Day.md')?.parentPath).toBe('Trips/Other/Coast.md');
  // A partial path resolves like Obsidian does: it picks the one trip whose path ends with it.
  expect(resolveTargets('[[Other/Coast]]', duplicate.map(n => n.path))).toEqual(['Trips/Other/Coast.md']);
  expect(resolveTargets('[[ther/Coast]]', ['Trips/Other/Coast.md'])).toEqual([]);
  expect(resolveTargets('[[Other/Coast]]', ['Other/Coast.md', 'Trips/Other/Coast.md'])).toEqual(['Other/Coast.md']);
  expect(resolveTargets('[[Other/Coast]]', ['A/Other/Coast.md', 'B/Other/Coast.md'])).toHaveLength(2);
  const partial = structuredClone(duplicate);
  const day = partial.find(n => n.path === 'Trips/Day.md')!;
  day.properties.backlink = '[[Other/Coast]]';
  expect(buildIndex(profile, partial, partial.map(n => n.path)).find(n => n.path === 'Trips/Day.md')?.parentPath).toBe('Trips/Other/Coast.md');
});
it('a link that points exactly at a non-trip note is not adopted as a same-named trip', () => {
  const day = (backlink: string) => ({
    ...notes[1]!,
    properties: { ...notes[1]!.properties, backlink },
  });
  // Root Coast.md is outside scope; Trips/Coast.md is a recognised trip with the same name.
  const outside = [
    notes[0]!,
    day('[[Coast.md]]'),
  ];
  const result = buildIndex(profile, outside, [
    'Coast.md',
    ...outside.map(n => n.path),
  ]).find(n => n.path === 'Trips/Day.md');
  expect(result?.parentPath).toBeUndefined();
  expect(result?.diagnostics.map(d => d.capability)).toContain('parent');
  // Same for an in-scope note that isn't a trip.
  const inScope = [
    notes[0]!,
    day('[[Trips/Notes/Coast]]'),
    { path: 'Trips/Notes/Coast.md', properties: {} },
  ];
  expect(buildIndex(profile, inScope, inScope.map(n => n.path)).find(n => n.path === 'Trips/Day.md')?.parentPath).toBeUndefined();
});
it('out-of-range dates are diagnosed without repair', () => {
  const input = structuredClone(notes);
  if (input[1])
    input[1].properties.endDate = '2026-05-10';
  expect(buildIndex(profile, input, io.paths()).find(n => n.path === 'Trips/Day.md')?.diagnostics.some(d => d.message.includes('outside the trip'))).toBe(true);
  expect(input[1]?.properties.endDate).toBe('2026-05-10');
});
it('a note without a parent link is detached, which is not a problem to report', () => {
  const input = structuredClone(notes);
  delete input[1]?.properties.backlink;
  const day = buildIndex(profile, input, io.paths()).find(n => n.path === 'Trips/Day.md');
  expect(day).toMatchObject({ detached: true, diagnostics: [] });
  expect(day?.parentPath).toBeUndefined();
  expect(buildIndex(profile, input, io.paths()).find(n => n.path === 'Trips/Coast.md')?.detached).toBeUndefined();
});
it('preset trips sharing the Travel Base are told apart by the Bases they embed, as in the author’s vault', () => {
  const preset = presetProfile();
  const base = { base: '[[Travel.base]]', startDate: '2026-05-01', endDate: '2026-05-09' };
  const trips: NoteSnapshot[] = [
    { path: 'Travel/Mykonos.md', properties: base, embeds: [] },
    {
      path: 'Travel/Korea/Korea.md',
      properties: base,
      embeds: ['Planning.base', 'Activities.base#Grouped by location'],
    },
    {
      path: 'Travel/Madeira/Madeira.md',
      properties: base,
      embeds: ['Activities.base', 'Travel/Madeira/Photography/Photography.base'],
    },
    {
      path: 'Travel/Croatia/Croatia.md',
      properties: base,
      embeds: ['Roadtrip.base'],
    },
    {
      path: 'Travel/Croatia/Roadtrip/Hvar.md',
      properties: {
        base: '[[_templates/Bases/Roadtrip.base]]',
        backlink: '[[Croatia]]',
        startDate: '2026-05-02',
        endDate: '2026-05-03',
      },
    },
  ];
  const paths = [
    ...new Set([
      ...trips.map(n => n.path),
      ...preset.types.flatMap(type => type.basePath
        ? [type.basePath]
        : []),
    ]),
  ];
  const index = new Map(buildIndex(preset, trips, paths).map(n => [n.path, n]));
  expect([
    ...index.values(),
  ].map(n => [
    n.path.split('/').pop(),
    n.typeId,
  ])).toEqual([
    ['Croatia.md', 'roadtrip'],
    ['Hvar.md', 'stop'],
    ['Korea.md', 'advanced'],
    ['Madeira.md', 'advanced'],
    ['Mykonos.md', 'simple'],
  ]);
  expect(index.get('Travel/Croatia/Roadtrip/Hvar.md')).toMatchObject({ parentPath: 'Travel/Croatia/Croatia.md', diagnostics: [] });
  // The author's explicit choice still wins over the guess.
  expect(buildIndex(preset, trips, paths, {
    'Travel/Mykonos.md': { typeId: 'advanced' },
  }).find(n => n.path === 'Travel/Mykonos.md')?.typeId).toBe('advanced');
});
it('custom trip kinds without explicit contents stay a choice for the author', () => {
  const a = {
    ...newType('a'),
    recognition: { property: 'kind', value: 'trip' },
  };
  const b = {
    ...newType('b'),
    recognition: { property: 'kind', value: 'trip' },
  };
  const [note] = buildIndex({
    name: 'C',
    scopes: ['Trips'],
    types: [a, b],
  }, [
    {
      path: 'Trips/X.md',
      properties: { kind: 'trip' },
      embeds: [],
    },
  ], ['Trips/X.md']);
  expect(note).toMatchObject({
    typeId: undefined,
    candidates: ['a', 'b'],
  });
});
