import type { BatchPlan } from '../../editing/batch';
import type { EntryRow } from '../../ui/itinerary/layout';
import type { ItineraryDataHost, ItineraryModel } from '../../ui/itinerary/model';
import type { CliContext } from '../commands';
import { expect, it } from 'vitest';
import { tripLayout } from '../../ui/itinerary/layout';
import { loadItinerary } from '../../ui/itinerary/model';
import { applyPlan, assignmentPlan, extensionPlan, movePlan, spanPlan } from '../../ui/itinerary/operations';
import { dataHost } from '../commands';
import { assign, reschedule } from '../edits';
import { answer } from '../reply';
import { assignRequest, rescheduleRequest } from '../request';
import { activityNote, cliVault, TRIP, tripNote } from './fixture';

const ALFAMA = 'Travel/2026/Lisbon/Planning/Alfama.md';
const BELEM = 'Travel/2026/Lisbon/Planning/Belém.md';
const SINTRA = 'Travel/2026/Lisbon/Roadtrip/Sintra.md';
const activity = (name: string) => `Travel/2026/Lisbon/Activities/${name}.md`;
const lines = (...parts: string[]) => parts.join('\n');

const alfama = (activities = '["[[Tram 28]]","[[Castelo]]","[[Miradouro]]"]', start = '2026-09-11', end = '2026-09-12') => `---\n{"base":"[[_templates/Bases/Planning.base]]","backlink":"[[Lisbon]]","Activities":${activities},"startDate":"${start}","endDate":"${end}"}\n---\n`;
const ALFAMA_BODY = lines('Plan', '', '## 2026-09-11', '', '### Activities', '', '- [[Tram 28]]', '- [[Castelo]]', '- [[Miradouro]]', '', '## 2026-09-12', '', '### Activities', '', '');
const belem = (activities = '["[[Pastéis]]"]', start = '2026-09-12', end = '2026-09-13') => `---\n{"base":"[[_templates/Bases/Planning.base]]","backlink":"[[Lisbon]]","Activities":${activities},"startDate":"${start}","endDate":"${end}"}\n---\n`;
const BELEM_BODY = lines('Plan', '', '## 2026-09-12', '', '### Activities', '', '- [[Pastéis]]', '', '## 2026-09-13', '', '### Activities', '', '');
const sintra = (start = '2026-09-13', end = '2026-09-13') => `---\n{"base":"[[_templates/Bases/Roadtrip.base]]","backlink":"[[Lisbon]]","startDate":"${start}","endDate":"${end}"}\n---\nStop\n`;

/** Lisbon (2026-09-10 to 13) with day plans Alfama and Belém, the stop Sintra, and Elevador on no day. */
function files(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [TRIP]: tripNote(),
    [ALFAMA]: alfama() + ALFAMA_BODY,
    [BELEM]: belem() + BELEM_BODY,
    [SINTRA]: sintra(),
    ...Object.fromEntries([
      'Tram 28',
      'Castelo',
      'Miradouro',
      'Pastéis',
      'Elevador',
    ].map(name => [
      activity(name),
      activityNote(),
    ])),
    ...overrides,
  };
}
function vault(overrides: Record<string, string> = {}) {
  return cliVault(files(overrides), [TRIP]);
}

interface Reply { ok: boolean; command: string; data?: { completed: string[]; summary: string }; error?: { code: string; message: string; report?: unknown } }
async function assignWith(ctx: CliContext, flags: Record<string, string>): Promise<Reply> {
  return JSON.parse(await answer('trips:assign', async () => assign(ctx, assignRequest(flags)))) as Reply;
}
async function rescheduleWith(ctx: CliContext, flags: Record<string, string>): Promise<Reply> {
  return JSON.parse(await answer('trips:reschedule', async () => reschedule(ctx, rescheduleRequest(flags)))) as Reply;
}
async function refused(io: { files: Map<string, string>; writes: string[] }, code: string, attempt: () => Promise<Reply>): Promise<Reply> {
  const before = new Map(io.files);
  const reply = await attempt();
  expect(reply.ok).toBe(false);
  expect(reply.error?.code).toBe(code);
  expect(io.writes).toEqual([]);
  expect(io.files).toEqual(before);
  return reply;
}

/** The same action done the way the trip tab does it, on an identical vault. */
async function tab(overrides: Record<string, string>, make: (host: ItineraryDataHost, model: ItineraryModel, row: (path: string) => EntryRow) => BatchPlan) {
  const { io, ctx } = vault(overrides);
  const host = dataHost(ctx);
  const model = await loadItinerary(host, TRIP);
  const rows = tripLayout(model, io.paths()).entries;
  const report = await applyPlan(host, model, make(host, model, path => rows.find(row => row.note.snapshot.path === path)!));
  expect(report.failed).toBeUndefined();
  return io.files;
}

it.each<{ title: string; flags: Record<string, string>; expected: Record<string, string>; overrides?: Record<string, string>; plan: (host: ItineraryDataHost, model: ItineraryModel, row: (path: string) => EntryRow) => BatchPlan }>([
  {
    title: 'add, last on an empty day',
    flags: {
      action: 'add',
      activity: 'Elevador',
      entry: 'Alfama',
      day: '2026-09-12',
    },
    expected: {
      [ALFAMA]: alfama('["[[Tram 28]]","[[Castelo]]","[[Miradouro]]","[[Elevador]]"]') + lines('Plan', '', '## 2026-09-11', '', '### Activities', '', '- [[Tram 28]]', '- [[Castelo]]', '- [[Miradouro]]', '', '## 2026-09-12', '', '### Activities', '', '- [[Elevador]]', ''),
    },
    plan: (host: ItineraryDataHost, model: ItineraryModel, row: (path: string) => EntryRow) => movePlan(host, model, activity('Elevador'), row(ALFAMA), '2026-09-12'),
  },
  {
    title: 'add at position 2',
    flags: {
      action: 'add',
      activity: 'Elevador',
      entry: 'Alfama',
      day: '2026-09-11',
      position: '2',
    },
    expected: {
      [ALFAMA]: alfama('["[[Tram 28]]","[[Castelo]]","[[Miradouro]]","[[Elevador]]"]') + lines('Plan', '', '## 2026-09-11', '', '### Activities', '', '- [[Tram 28]]', '- [[Elevador]]', '- [[Castelo]]', '- [[Miradouro]]', '', '## 2026-09-12', '', '### Activities', '', ''),
    },
    plan: (host: ItineraryDataHost, model: ItineraryModel, row: (path: string) => EntryRow) => movePlan(host, model, activity('Elevador'), row(ALFAMA), '2026-09-11', undefined, 1),
  },
  {
    title: 'move to another day of the same entry',
    flags: {
      'action': 'move',
      'activity': 'Tram 28',
      'from-day': '2026-09-11',
      'entry': 'Alfama',
      'day': '2026-09-12',
    },
    expected: {
      [ALFAMA]: alfama() + lines('Plan', '', '## 2026-09-11', '', '### Activities', '', '- [[Castelo]]', '- [[Miradouro]]', '', '## 2026-09-12', '', '### Activities', '', '- [[Tram 28]]', ''),
    },
    plan: (host: ItineraryDataHost, model: ItineraryModel, row: (path: string) => EntryRow) => movePlan(host, model, activity('Tram 28'), row(ALFAMA), '2026-09-12', {
      row: row(ALFAMA),
      date: '2026-09-11',
    }),
  },
  {
    title: 'move to another entry: the source loses the day and, as it was the last one, the activity',
    flags: {
      'action': 'move',
      'activity': 'Pastéis',
      'from-entry': 'Belém',
      'from-day': '2026-09-12',
      'entry': 'Alfama',
      'day': '2026-09-12',
    },
    expected: {
      [BELEM]: `${belem('[]')}${lines('Plan', '', '## 2026-09-12', '', '### Activities', '', '## 2026-09-13', '', '### Activities', '', '')}`,
      [ALFAMA]: alfama('["[[Tram 28]]","[[Castelo]]","[[Miradouro]]","[[Pastéis]]"]') + lines('Plan', '', '## 2026-09-11', '', '### Activities', '', '- [[Tram 28]]', '- [[Castelo]]', '- [[Miradouro]]', '', '## 2026-09-12', '', '### Activities', '', '- [[Pastéis]]', ''),
    },
    plan: (host: ItineraryDataHost, model: ItineraryModel, row: (path: string) => EntryRow) => movePlan(host, model, activity('Pastéis'), row(ALFAMA), '2026-09-12', {
      row: row(BELEM),
      date: '2026-09-12',
    }),
  },
  {
    title: 'move to another entry from one of two days: the source keeps the activity',
    overrides: { [BELEM]: belem() + lines('Plan', '', '## 2026-09-12', '', '### Activities', '', '- [[Pastéis]]', '', '## 2026-09-13', '', '### Activities', '', '- [[Pastéis]]', '') },
    flags: {
      'action': 'move',
      'activity': 'Pastéis',
      'from-entry': 'Belém',
      'from-day': '2026-09-13',
      'entry': 'Alfama',
      'day': '2026-09-12',
    },
    expected: {
      [BELEM]: belem() + lines('Plan', '', '## 2026-09-12', '', '### Activities', '', '- [[Pastéis]]', '', '## 2026-09-13', '', '### Activities', '', ''),
      [ALFAMA]: alfama('["[[Tram 28]]","[[Castelo]]","[[Miradouro]]","[[Pastéis]]"]') + lines('Plan', '', '## 2026-09-11', '', '### Activities', '', '- [[Tram 28]]', '- [[Castelo]]', '- [[Miradouro]]', '', '## 2026-09-12', '', '### Activities', '', '- [[Pastéis]]', ''),
    },
    plan: (host: ItineraryDataHost, model: ItineraryModel, row: (path: string) => EntryRow) => movePlan(host, model, activity('Pastéis'), row(ALFAMA), '2026-09-12', {
      row: row(BELEM),
      date: '2026-09-13',
    }),
  },
  {
    title: 'reorder: the last of three activities to position 1',
    flags: {
      'action': 'move',
      'activity': 'Miradouro',
      'from-day': '2026-09-11',
      'entry': 'Alfama',
      'day': '2026-09-11',
      'position': '1',
    },
    expected: {
      [ALFAMA]: alfama() + lines('Plan', '', '## 2026-09-11', '', '### Activities', '', '- [[Miradouro]]', '- [[Tram 28]]', '- [[Castelo]]', '', '## 2026-09-12', '', '### Activities', '', ''),
    },
    plan: (host: ItineraryDataHost, model: ItineraryModel, row: (path: string) => EntryRow) => movePlan(host, model, activity('Miradouro'), row(ALFAMA), '2026-09-11', {
      row: row(ALFAMA),
      date: '2026-09-11',
    }, 0),
  },
  {
    title: 'remove from a day: it stays an activity of the entry',
    flags: {
      action: 'remove',
      activity: 'Castelo',
      entry: 'Alfama',
      day: '2026-09-11',
    },
    expected: {
      [ALFAMA]: alfama() + lines('Plan', '', '## 2026-09-11', '', '### Activities', '', '- [[Tram 28]]', '- [[Miradouro]]', '', '## 2026-09-12', '', '### Activities', '', ''),
    },
    plan: (host: ItineraryDataHost, model: ItineraryModel, row: (path: string) => EntryRow) => assignmentPlan(host, model, row(ALFAMA).note, {
      action: 'day-remove',
      target: activity('Castelo'),
      day: '2026-09-11',
    }),
  },
  {
    title: 'remove without a day: off the entry entirely',
    flags: { action: 'remove', activity: 'Castelo', entry: 'Alfama' },
    expected: {
      [ALFAMA]: alfama('["[[Tram 28]]","[[Miradouro]]"]') + lines('Plan', '', '## 2026-09-11', '', '### Activities', '', '- [[Tram 28]]', '- [[Miradouro]]', '', '## 2026-09-12', '', '### Activities', '', ''),
    },
    plan: (host: ItineraryDataHost, model: ItineraryModel, row: (path: string) => EntryRow) => assignmentPlan(host, model, row(ALFAMA).note, {
      action: 'full-remove',
      target: activity('Castelo'),
    }),
  },
])('assign $title: exact bytes, and the same bytes as the trip tab', async ({ flags, expected, plan, overrides = {} }) => {
  const { io, ctx } = vault(overrides);
  const before = new Map(io.files);
  const reply = await assignWith(ctx, { trip: 'Lisbon', ...flags });
  expect(reply.ok).toBe(true);
  expect(reply.data?.completed).toEqual(Object.keys(expected));
  for (const [path, content] of Object.entries(expected)) expect(io.files.get(path)).toBe(content);
  // Every other file is untouched.
  expect(new Map([...io.files].filter(([path]) => !(path in expected)))).toEqual(new Map([...before].filter(([path]) => !(path in expected))));
  expect(io.files).toEqual(await tab(overrides, plan));
});

it('json= takes the same request, with a JSON position', async () => {
  const { io, ctx } = vault();
  const reply = await assignWith(ctx, {
    json: JSON.stringify({
      'trip': 'Lisbon',
      'action': 'move',
      'activity': 'Miradouro',
      'from-day': '2026-09-11',
      'entry': 'Alfama',
      'day': '2026-09-11',
      'position': 1,
    }),
  });
  expect(reply).toMatchObject({
    ok: true,
    data: {
      completed: [ALFAMA],
      summary: expect.stringContaining('Reordered') as string,
    },
  });
  expect(io.files.get(ALFAMA)).toBe(alfama() + lines('Plan', '', '## 2026-09-11', '', '### Activities', '', '- [[Miradouro]]', '- [[Tram 28]]', '- [[Castelo]]', '', '## 2026-09-12', '', '### Activities', '', ''));
});

it.each<{ title: string; flags: Record<string, string>; expected: Record<string, string>; plan: (model: ItineraryModel, row: (path: string) => EntryRow) => BatchPlan }>([
  {
    title: 'move a day plan',
    flags: { entry: 'Belém', start: '2026-09-11', end: '2026-09-12' },
    expected: { [BELEM]: belem('["[[Pastéis]]"]', '2026-09-11', '2026-09-12') + BELEM_BODY },
    plan: (model: ItineraryModel, row: (path: string) => EntryRow) => spanPlan(model, row(BELEM).note, { start: '2026-09-11', end: '2026-09-12' }),
  },
  {
    title: 'make a day plan longer',
    flags: { entry: 'Alfama', start: '2026-09-11', end: '2026-09-13' },
    expected: { [ALFAMA]: alfama(undefined, '2026-09-11', '2026-09-13') + ALFAMA_BODY },
    plan: (model: ItineraryModel, row: (path: string) => EntryRow) => spanPlan(model, row(ALFAMA).note, { start: '2026-09-11', end: '2026-09-13' }),
  },
  {
    title: 'move a stop',
    flags: { entry: 'Sintra', start: '2026-09-12', end: '2026-09-13' },
    expected: {
      [SINTRA]: sintra('2026-09-12', '2026-09-13'),
    },
    plan: (model: ItineraryModel, row: (path: string) => EntryRow) => spanPlan(model, row(SINTRA).note, { start: '2026-09-12', end: '2026-09-13' }),
  },
  {
    title: 'grow the trip along with an entry, with extend',
    flags: {
      entry: 'Belém',
      start: '2026-09-13',
      end: '2026-09-14',
      extend: 'true',
    },
    expected: {
      [TRIP]: tripNote('2026-09-10', '2026-09-14'),
      [BELEM]: belem('["[[Pastéis]]"]', '2026-09-13', '2026-09-14') + BELEM_BODY,
    },
    plan: (model: ItineraryModel, row: (path: string) => EntryRow) => spanPlan(model, row(BELEM).note, { start: '2026-09-13', end: '2026-09-14' }, true),
  },
  {
    title: 'widen the trip',
    flags: { start: '2026-09-09', end: '2026-09-14' },
    expected: {
      [TRIP]: tripNote('2026-09-09', '2026-09-14'),
    },
    plan: (model: ItineraryModel) => extensionPlan(model, '2026-09-09', '2026-09-14'),
  },
])('reschedule: $title, exact bytes and the same as the trip tab', async ({ flags, expected, plan }) => {
  const { io, ctx } = vault();
  const before = new Map(io.files);
  const reply = await rescheduleWith(ctx, { trip: 'Lisbon', ...flags });
  expect(reply.ok).toBe(true);
  expect(reply.data?.completed).toEqual(Object.keys(expected));
  for (const [path, content] of Object.entries(expected)) expect(io.files.get(path)).toBe(content);
  expect(new Map([...io.files].filter(([path]) => !(path in expected)))).toEqual(new Map([...before].filter(([path]) => !(path in expected))));
  expect(io.files).toEqual(await tab({}, (_, model, row) => plan(model, row)));
});

it('reschedule refuses dates outside the trip without extend, and narrowing the trip', async () => {
  const { io, ctx } = vault();
  const outside = await refused(io, 'OUTSIDE_TRIP', async () => rescheduleWith(ctx, {
    trip: 'Lisbon',
    entry: 'Belém',
    start: '2026-09-13',
    end: '2026-09-14',
  }));
  expect(outside.error?.message).toContain('2026-09-10 to 2026-09-14');
  expect(outside.error?.message).toContain('extend');
  const narrower = await refused(io, 'DATES_INVALID', async () => rescheduleWith(ctx, { trip: 'Lisbon', start: '2026-09-11', end: '2026-09-13' }));
  expect(narrower.error?.message).toContain('without narrowing');
  await refused(io, 'DATES_INVALID', async () => rescheduleWith(ctx, {
    trip: 'Lisbon',
    entry: 'Belém',
    start: '2026-09-13',
    end: '2026-09-12',
  }));
});

it('shortening an entry strands activities on a day outside it, and remove takes them off that day', async () => {
  const { io, ctx } = vault();
  const shorter = await rescheduleWith(ctx, {
    trip: 'Lisbon',
    entry: 'Alfama',
    start: '2026-09-12',
    end: '2026-09-12',
  });
  expect(shorter.ok).toBe(true);
  expect(shorter.data?.summary).toContain('3 activities are on days outside it now.');
  expect(shorter.data?.summary).toContain('Dates written inside the note weren\'t changed.');
  expect(io.files.get(ALFAMA)).toBe(alfama(undefined, '2026-09-12', '2026-09-12') + ALFAMA_BODY);

  const removed = await assignWith(ctx, {
    trip: 'Lisbon',
    action: 'remove',
    activity: 'Tram 28',
    entry: 'Alfama',
    day: '2026-09-11',
  });
  expect(removed.ok).toBe(true);
  expect(io.files.get(ALFAMA)).toBe(alfama(undefined, '2026-09-12', '2026-09-12') + lines('Plan', '', '## 2026-09-11', '', '### Activities', '', '- [[Castelo]]', '- [[Miradouro]]', '', '## 2026-09-12', '', '### Activities', '', ''));
  // But nothing can be put on that day any more.
  await refused(Object.assign(io, { writes: [] }), 'DAY_OUTSIDE_ENTRY', async () => assignWith(ctx, {
    trip: 'Lisbon',
    action: 'add',
    activity: 'Elevador',
    entry: 'Alfama',
    day: '2026-09-11',
  }));
});

it.each([
  [
    'flags and json together',
    { trip: 'Lisbon', json: '{}' },
  ],
  [
    'no action',
    {
      trip: 'Lisbon',
      activity: 'Elevador',
      entry: 'Alfama',
      day: '2026-09-12',
    },
  ],
  [
    'an unknown action',
    {
      trip: 'Lisbon',
      action: 'copy',
      activity: 'Elevador',
      entry: 'Alfama',
      day: '2026-09-12',
    },
  ],
  [
    'an unknown flag',
    {
      trip: 'Lisbon',
      action: 'add',
      activity: 'Elevador',
      entry: 'Alfama',
      day: '2026-09-12',
      note: 'x',
    },
  ],
  [
    'add without day',
    {
      trip: 'Lisbon',
      action: 'add',
      activity: 'Elevador',
      entry: 'Alfama',
    },
  ],
  [
    'add without entry',
    {
      trip: 'Lisbon',
      action: 'add',
      activity: 'Elevador',
      day: '2026-09-12',
    },
  ],
  [
    'add without activity',
    {
      trip: 'Lisbon',
      action: 'add',
      entry: 'Alfama',
      day: '2026-09-12',
    },
  ],
  [
    'add without trip',
    {
      action: 'add',
      activity: 'Elevador',
      entry: 'Alfama',
      day: '2026-09-12',
    },
  ],
  [
    'add with from-day',
    {
      'trip': 'Lisbon',
      'action': 'add',
      'activity': 'Elevador',
      'entry': 'Alfama',
      'day': '2026-09-12',
      'from-day': '2026-09-11',
    },
  ],
  [
    'move without from-day',
    {
      trip: 'Lisbon',
      action: 'move',
      activity: 'Tram 28',
      entry: 'Alfama',
      day: '2026-09-12',
    },
  ],
  [
    'move without day',
    {
      'trip': 'Lisbon',
      'action': 'move',
      'activity': 'Tram 28',
      'entry': 'Alfama',
      'from-day': '2026-09-11',
    },
  ],
  [
    'remove without entry',
    { trip: 'Lisbon', action: 'remove', activity: 'Tram 28' },
  ],
  [
    'remove with position',
    {
      trip: 'Lisbon',
      action: 'remove',
      activity: 'Tram 28',
      entry: 'Alfama',
      position: '1',
    },
  ],
  [
    'a bad day',
    {
      trip: 'Lisbon',
      action: 'add',
      activity: 'Elevador',
      entry: 'Alfama',
      day: '2026-09-31',
    },
  ],
  [
    'a bad from-day',
    {
      'trip': 'Lisbon',
      'action': 'move',
      'activity': 'Tram 28',
      'entry': 'Alfama',
      'from-day': '11/09/2026',
      'day': '2026-09-12',
    },
  ],
  [
    'position=0',
    {
      trip: 'Lisbon',
      action: 'add',
      activity: 'Elevador',
      entry: 'Alfama',
      day: '2026-09-12',
      position: '0',
    },
  ],
  [
    'position=-1',
    {
      trip: 'Lisbon',
      action: 'add',
      activity: 'Elevador',
      entry: 'Alfama',
      day: '2026-09-12',
      position: '-1',
    },
  ],
  [
    'position=1.5',
    {
      trip: 'Lisbon',
      action: 'add',
      activity: 'Elevador',
      entry: 'Alfama',
      day: '2026-09-12',
      position: '1.5',
    },
  ],
  [
    'position=abc',
    {
      trip: 'Lisbon',
      action: 'add',
      activity: 'Elevador',
      entry: 'Alfama',
      day: '2026-09-12',
      position: 'abc',
    },
  ],
  [
    'a bare position flag',
    {
      trip: 'Lisbon',
      action: 'add',
      activity: 'Elevador',
      entry: 'Alfama',
      day: '2026-09-12',
      position: 'true',
    },
  ],
  [
    'a JSON position 1.5',
    {
      json: JSON.stringify({
        trip: 'Lisbon',
        action: 'add',
        activity: 'Elevador',
        entry: 'Alfama',
        day: '2026-09-12',
        position: 1.5,
      }),
    },
  ],
  [
    'a JSON position 0',
    {
      json: JSON.stringify({
        trip: 'Lisbon',
        action: 'add',
        activity: 'Elevador',
        entry: 'Alfama',
        day: '2026-09-12',
        position: 0,
      }),
    },
  ],
])('assign refuses %s as INVALID_INPUT', async (_, flags) => {
  const { io, ctx } = vault();
  await refused(io, 'INVALID_INPUT', async () => assignWith(ctx, flags));
});

it.each([
  [
    'flags and json together',
    { trip: 'Lisbon', json: '{}' },
  ],
  [
    'no trip',
    { start: '2026-09-09', end: '2026-09-14' },
  ],
  [
    'no start',
    { trip: 'Lisbon', end: '2026-09-14' },
  ],
  [
    'no end',
    { trip: 'Lisbon', start: '2026-09-09' },
  ],
  [
    'a bad date',
    { trip: 'Lisbon', start: '2026-9-9', end: '2026-09-14' },
  ],
  [
    'extend=false',
    {
      trip: 'Lisbon',
      entry: 'Belém',
      start: '2026-09-13',
      end: '2026-09-14',
      extend: 'false',
    },
  ],
  [
    'extend=0',
    {
      trip: 'Lisbon',
      entry: 'Belém',
      start: '2026-09-13',
      end: '2026-09-14',
      extend: '0',
    },
  ],
  [
    'JSON extend false',
    {
      json: JSON.stringify({
        trip: 'Lisbon',
        entry: 'Belém',
        start: '2026-09-13',
        end: '2026-09-14',
        extend: false,
      }),
    },
  ],
  [
    'extend without entry',
    {
      trip: 'Lisbon',
      start: '2026-09-09',
      end: '2026-09-14',
      extend: 'true',
    },
  ],
  [
    'an unknown flag',
    {
      trip: 'Lisbon',
      start: '2026-09-09',
      end: '2026-09-14',
      day: '2026-09-10',
    },
  ],
])('reschedule refuses %s as INVALID_INPUT', async (_, flags) => {
  const { io, ctx } = vault();
  await refused(io, 'INVALID_INPUT', async () => rescheduleWith(ctx, flags));
});

it('jSON extend true grows the trip', async () => {
  const { io, ctx } = vault();
  const reply = await rescheduleWith(ctx, {
    json: JSON.stringify({
      trip: 'Lisbon',
      entry: 'Belém',
      start: '2026-09-13',
      end: '2026-09-14',
      extend: true,
    }),
  });
  expect(reply.data?.completed).toEqual([TRIP, BELEM]);
  expect(io.files.get(TRIP)).toBe(tripNote('2026-09-10', '2026-09-14'));
});

it('refuses unknown and ambiguous trips, entries and activities, listing the candidates', async () => {
  const add = {
    action: 'add',
    activity: 'Elevador',
    entry: 'Alfama',
    day: '2026-09-12',
  };
  const plain = vault();
  await refused(plain.io, 'PARENT_NOT_FOUND', async () => assignWith(plain.ctx, { ...add, trip: 'Porto' }));
  await refused(plain.io, 'NOTE_NOT_FOUND', async () => assignWith(plain.ctx, { ...add, trip: 'Lisbon', entry: 'Chiado' }));
  await refused(plain.io, 'NOTE_NOT_FOUND', async () => rescheduleWith(plain.ctx, {
    trip: 'Lisbon',
    entry: 'Chiado',
    start: '2026-09-11',
    end: '2026-09-11',
  }));
  await refused(plain.io, 'ACTIVITY_NOT_FOUND', async () => assignWith(plain.ctx, { ...add, trip: 'Lisbon', activity: 'Fado' }));
  // Activities and entries come from this trip only.
  await refused(plain.io, 'NOTE_NOT_FOUND', async () => assignWith(plain.ctx, { ...add, trip: 'Lisbon', entry: 'Lisbon' }));

  const other = 'Travel/2025/Lisbon/Lisbon.md';
  // With two notes named Lisbon, the children link their trip by path, as Obsidian would write it.
  const byPath = Object.fromEntries(Object.entries(files()).map(([path, content]) => [
    path,
    content.replace('"backlink":"[[Lisbon]]"', '"backlink":"[[Travel/2026/Lisbon/Lisbon]]"'),
  ]));
  const twoTrips = cliVault({
    ...byPath,
    [other]: tripNote('2025-05-01', '2025-05-03'),
  }, [TRIP, other]);
  const trip = await refused(twoTrips.io, 'PARENT_AMBIGUOUS', async () => assignWith(twoTrips.ctx, { ...add, trip: 'Lisbon' }));
  expect(trip.error?.message).toContain(other);
  expect((await assignWith(twoTrips.ctx, { ...add, trip: TRIP })).ok).toBe(true);

  const stopAlfama = 'Travel/2026/Lisbon/Roadtrip/Alfama.md';
  const twoEntries = vault({
    [stopAlfama]: sintra(),
  });
  const entry = await refused(twoEntries.io, 'NOTE_AMBIGUOUS', async () => assignWith(twoEntries.ctx, { ...add, trip: 'Lisbon' }));
  expect(entry.error?.message).toContain(stopAlfama);

  const oldElevador = 'Travel/2026/Lisbon/Activities/Old/Elevador.md';
  const twoActivities = vault({
    [oldElevador]: activityNote(),
  });
  const named = await refused(twoActivities.io, 'ACTIVITY_AMBIGUOUS', async () => assignWith(twoActivities.ctx, { ...add, trip: 'Lisbon' }));
  expect(named.error?.message).toContain(oldElevador);
});

it('refuses NOT_ON_DAY when the activity is not where the request says', async () => {
  const { io, ctx } = vault();
  await refused(io, 'NOT_ON_DAY', async () => assignWith(ctx, {
    'trip': 'Lisbon',
    'action': 'move',
    'activity': 'Elevador',
    'from-day': '2026-09-11',
    'entry': 'Alfama',
    'day': '2026-09-12',
  }));
  await refused(io, 'NOT_ON_DAY', async () => assignWith(ctx, {
    'trip': 'Lisbon',
    'action': 'move',
    'activity': 'Tram 28',
    'from-day': '2026-09-12',
    'entry': 'Alfama',
    'day': '2026-09-11',
  }));
  await refused(io, 'NOT_ON_DAY', async () => assignWith(ctx, {
    'trip': 'Lisbon',
    'action': 'move',
    'activity': 'Tram 28',
    'from-entry': 'Belém',
    'from-day': '2026-09-11',
    'entry': 'Alfama',
    'day': '2026-09-12',
  }));
  await refused(io, 'NOT_ON_DAY', async () => assignWith(ctx, {
    trip: 'Lisbon',
    action: 'remove',
    activity: 'Tram 28',
    entry: 'Alfama',
    day: '2026-09-12',
  }));
  await refused(io, 'NOT_ON_DAY', async () => assignWith(ctx, {
    trip: 'Lisbon',
    action: 'remove',
    activity: 'Elevador',
    entry: 'Alfama',
  }));
});

it('refuses DAY_OUTSIDE_ENTRY for a day outside the entry, or inside the entry but outside the trip', async () => {
  const { io, ctx } = vault({ [BELEM]: belem('["[[Pastéis]]"]', '2026-09-12', '2026-09-14') + BELEM_BODY });
  const entry = await refused(io, 'DAY_OUTSIDE_ENTRY', async () => assignWith(ctx, {
    trip: 'Lisbon',
    action: 'add',
    activity: 'Elevador',
    entry: 'Alfama',
    day: '2026-09-13',
  }));
  expect(entry.error?.message).toContain('2026-09-11 to 2026-09-12');
  const trip = await refused(io, 'DAY_OUTSIDE_ENTRY', async () => assignWith(ctx, {
    'trip': 'Lisbon',
    'action': 'move',
    'activity': 'Pastéis',
    'from-day': '2026-09-12',
    'entry': 'Belém',
    'day': '2026-09-14',
  }));
  expect(trip.error?.message).toContain('2026-09-12 to 2026-09-13');
});

it('refuses CANNOT_EDIT when the entry ends inside a comment', async () => {
  const { io, ctx } = vault({ [ALFAMA]: `${alfama()}${ALFAMA_BODY}%% unfinished\n` });
  const reply = await refused(io, 'CANNOT_EDIT', async () => assignWith(ctx, {
    trip: 'Lisbon',
    action: 'add',
    activity: 'Elevador',
    entry: 'Alfama',
    day: '2026-09-12',
  }));
  expect(reply.error?.message).toContain('Fix the note in Obsidian first');
});

it('refuses CHANGED when the settings change after the trip was read, or while it was read', async () => {
  const after = vault();
  const replaceSettings = () => {
    after.state.settings = {
      ...after.state.settings,
      resolutions: {
        ...after.state.settings.resolutions,
        'Travel/x.md': { typeId: 'advanced' },
      },
    };
  };
  // The layout is computed once loading is done.
  const paths = after.io.paths;
  after.io.paths = () => {
    replaceSettings();
    return paths();
  };
  await refused(after.io, 'CHANGED', async () => assignWith(after.ctx, {
    trip: 'Lisbon',
    action: 'add',
    activity: 'Elevador',
    entry: 'Alfama',
    day: '2026-09-12',
  }));

  const during = vault();
  const read = during.io.read.bind(during.io);
  during.io.read = async (path: string) => {
    during.state.settings = {
      ...during.state.settings,
      resolutions: {
        ...during.state.settings.resolutions,
        'Travel/x.md': { typeId: 'advanced' },
      },
    };
    return read(path);
  };
  const reply = await refused(during.io, 'CHANGED', async () => rescheduleWith(during.ctx, { trip: 'Lisbon', start: '2026-09-09', end: '2026-09-14' }));
  expect(reply.error?.message).toContain('nothing was written');
});

it('reports WRITE_FAILED with nothing completed when a note is edited outside between reading and writing', async () => {
  const { io, ctx } = vault();
  const edited = `${alfama()}${ALFAMA_BODY}Edited elsewhere\n`;
  const paths = io.paths;
  io.paths = () => {
    io.files.set(ALFAMA, edited);
    return paths();
  };
  const reply = await assignWith(ctx, {
    trip: 'Lisbon',
    action: 'add',
    activity: 'Elevador',
    entry: 'Alfama',
    day: '2026-09-12',
  });
  expect(reply.ok).toBe(false);
  expect(reply.error?.code).toBe('WRITE_FAILED');
  expect(reply.error?.report).toEqual({ completed: [], failed: ALFAMA, untouched: [] });
  expect(io.writes).toEqual([]);
  expect(io.files.get(ALFAMA)).toBe(edited);
});

it('reports a cross-entry move that fails on its second file, with the first one written', async () => {
  const { io, ctx } = vault();
  io.failPath = ALFAMA;
  const reply = await assignWith(ctx, {
    'trip': 'Lisbon',
    'action': 'move',
    'activity': 'Pastéis',
    'from-entry': 'Belém',
    'from-day': '2026-09-12',
    'entry': 'Alfama',
    'day': '2026-09-12',
  });
  expect(reply.ok).toBe(false);
  expect(reply.error?.code).toBe('WRITE_FAILED');
  expect(reply.error?.report).toEqual({
    completed: [BELEM],
    failed: ALFAMA,
    untouched: [],
  });
  expect(reply.error?.message).toContain('check them with trips:list before retrying');
  expect(io.files.get(BELEM)).toBe(`${belem('[]')}${lines('Plan', '', '## 2026-09-12', '', '### Activities', '', '## 2026-09-13', '', '### Activities', '', '')}`);
  expect(io.files.get(ALFAMA)).toBe(alfama() + ALFAMA_BODY);
});

it('stops a cross-entry move when its second file is edited outside after the first write, keeping that edit', async () => {
  const { io, ctx } = vault();
  const edited = `${alfama()}${ALFAMA_BODY}Edited elsewhere\n`;
  const replace = io.replace.bind(io);
  io.replace = async (expected, content) => {
    await replace(expected, content);
    io.files.set(ALFAMA, edited);
  };
  const reply = await assignWith(ctx, {
    'trip': 'Lisbon',
    'action': 'move',
    'activity': 'Pastéis',
    'from-entry': 'Belém',
    'from-day': '2026-09-12',
    'entry': 'Alfama',
    'day': '2026-09-12',
  });
  expect(reply.error?.code).toBe('WRITE_FAILED');
  expect(reply.error?.report).toEqual({
    completed: [BELEM],
    failed: ALFAMA,
    untouched: [],
  });
  expect(io.writes).toEqual([BELEM]);
  expect(io.files.get(ALFAMA)).toBe(edited);
});
