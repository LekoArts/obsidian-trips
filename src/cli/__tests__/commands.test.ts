import type { CliContext } from '../commands';
import { expect, it } from 'vitest';
import { emptySettings } from '../../config/profile';
import { applyCreation, previewCreation } from '../../creation/create';
import { buildDraft } from '../../creation/draft';
import { create, kinds, list, status } from '../commands';
import { answer } from '../reply';
import { createRequest } from '../request';
import { activityNote, cliVault, TRIP, tripNote } from './fixture';

const TRAM = 'Travel/2026/Lisbon/Activities/Tram 28.md';
const ALFAMA = 'Travel/2026/Lisbon/Planning/Alfama.md';
const alfamaNote = [
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
].join('\n');

interface Reply { ok: boolean; command: string; data?: Record<string, unknown>; error?: { code: string; message: string; report?: unknown } }
async function call(command: string, run: () => unknown): Promise<Reply> {
  return JSON.parse(await answer(command, run)) as Reply;
}
async function createWith(ctx: CliContext, flags: Record<string, string>) {
  return call('trips:create', async () => create(ctx, createRequest(flags)));
}
function json(request: unknown) {
  return {
    json: JSON.stringify(request),
  };
}

/** Runs `attempt` and checks it was refused with `code` and changed no file. */
async function refused(io: { files: Map<string, string>; writes: string[] }, code: string, attempt: () => Promise<Reply>): Promise<Reply> {
  const before = new Map(io.files);
  const reply = await attempt();
  expect(reply.ok).toBe(false);
  expect(reply.error?.code).toBe(code);
  expect(io.writes).toEqual([]);
  expect(io.files).toEqual(before);
  return reply;
}

it('answers NOT_SET_UP for every command when there are no kinds or the setup is broken', async () => {
  const { io, ctx, state } = cliVault();
  state.settings = emptySettings();
  for (const [command, run] of [
    [
      'trips:status',
      () => status(ctx),
    ],
    [
      'trips:kinds',
      () => kinds(ctx),
    ],
    [
      'trips:list',
      async () => list(ctx),
    ],
    [
      'trips:create',
      async () => create(ctx, createRequest({
        kind: 'advanced',
        name: 'Lisbon',
        start: '2026-09-10',
        end: '2026-09-13',
      })),
    ],
  ] as const) {
    const reply = await refused(io, 'NOT_SET_UP', async () => call(command, run));
    expect(reply.error?.message).toContain('Settings → Trips');
  }
  const broken = cliVault();
  broken.io.files.delete('_templates/Planning.md');
  const reply = await refused(broken.io, 'NOT_SET_UP', async () => call('trips:status', () => status(broken.ctx)));
  expect(reply.error?.message).toContain('Template not found: _templates/Planning.md');
});

it('refuses bad create requests before writing anything', async () => {
  const { io, ctx, state } = cliVault({
    [TRIP]: tripNote(),
    [TRAM]: activityNote(),
  }, [TRIP]);
  expect((await refused(io, 'UNKNOWN_KIND', async () => createWith(ctx, { kind: 'cruise', name: 'Lisbon' }))).error?.message).toContain('simple, advanced, roadtrip, planning, stop, activity');
  await refused(io, 'UNKNOWN_KIND', async () => createWith(ctx, {
    kind: 'stop',
    name: 'Sintra',
    trip: 'Lisbon',
    start: '2026-09-11',
    end: '2026-09-11',
  }));
  await refused(io, 'INVALID_INPUT', async () => createWith(ctx, json({
    kind: 'activity',
    name: 'Tram',
    trip: 'Lisbon',
    colour: 'red',
  })));
  await refused(io, 'INVALID_INPUT', async () => createWith(ctx, json({
    kind: 'activity',
    name: 'Tram',
    trip: 'Lisbon',
    fields: { Price: 3 },
  })));
  await refused(io, 'INVALID_INPUT', async () => createWith(ctx, { kind: 'activity', name: 'Tram' }));
  await refused(io, 'INVALID_INPUT', async () => createWith(ctx, { kind: 'activity', name: 'Tram/28', trip: 'Lisbon' }));
  await refused(io, 'INVALID_INPUT', async () => createWith(ctx, json({
    kind: 'activity',
    name: 'Tram',
    trip: 'Lisbon',
    fields: {
      Location: ['a'],
    },
  })));
  await refused(io, 'INVALID_INPUT', async () => createWith(ctx, json({
    kind: 'activity',
    name: 'Tram',
    trip: 'Lisbon',
    fields: { Done: 'maybe' },
  })));
  await refused(io, 'DATES_INVALID', async () => createWith(ctx, {
    kind: 'planning',
    name: 'Alfama',
    trip: 'Lisbon',
    start: '2026-09-31',
    end: '2026-10-01',
  }));
  await refused(io, 'DATES_INVALID', async () => createWith(ctx, {
    kind: 'planning',
    name: 'Alfama',
    trip: 'Lisbon',
    start: '2026-09-12',
    end: '2026-09-11',
  }));
  await refused(io, 'DATES_INVALID', async () => createWith(ctx, { kind: 'planning', name: 'Alfama', trip: 'Lisbon' }));
  expect((await refused(io, 'DATES_INVALID', async () => createWith(ctx, {
    kind: 'planning',
    name: 'Alfama',
    trip: 'Lisbon',
    start: '2026-09-09',
    end: '2026-09-11',
  }))).error?.message).toContain('2026-09-10 to 2026-09-13');
  await refused(io, 'DATES_INVALID', async () => createWith(ctx, json({
    kind: 'planning',
    name: 'Alfama',
    trip: 'Lisbon',
    start: '2026-09-11',
    end: '2026-09-12',
    activities: [
      { name: 'Tram 28', day: '2026-09-13' },
    ],
  })));
  expect((await refused(io, 'DESTINATION_EXISTS', async () => createWith(ctx, { kind: 'activity', name: 'Tram 28', trip: 'Lisbon' }))).error?.message).toContain(TRAM);
  expect(state.refreshes).toBe(0);
});

it('looks for a trip again after refreshing, then names the problem', async () => {
  const other = 'Travel/2027/Lisbon/Lisbon.md';
  const { io, ctx, state } = cliVault({
    [TRIP]: tripNote(),
    [other]: tripNote('2027-09-10', '2027-09-13'),
  }, [TRIP, other]);
  await refused(io, 'INVALID_INPUT', async () => createWith(ctx, { kind: 'activity', name: 'Tram 28' }));
  expect((await refused(io, 'PARENT_AMBIGUOUS', async () => createWith(ctx, { kind: 'activity', name: 'Tram 28', trip: 'Lisbon' }))).error?.message).toContain(`${TRIP}, ${other}`);
  expect(state.refreshes).toBe(0);
  expect((await refused(io, 'PARENT_NOT_FOUND', async () => createWith(ctx, { kind: 'activity', name: 'Tram 28', trip: 'Porto' }))).error?.message).toContain('retry in a moment');
  expect(state.refreshes).toBe(8);
});

it('finds an activity the index missed after one refresh, and gives up on one that never appears', async () => {
  const { io, ctx, state } = cliVault({
    [TRIP]: tripNote(),
    [TRAM]: activityNote(),
  }, [TRIP]);
  state.hidden.add(TRAM);
  const reply = await createWith(ctx, json({
    kind: 'planning',
    name: 'Alfama',
    trip: 'Lisbon',
    start: '2026-09-11',
    end: '2026-09-12',
    activities: [
      { name: 'Tram 28', day: '2026-09-11' },
    ],
  }));
  expect(reply).toEqual({
    apiVersion: 1,
    ok: true,
    command: 'trips:create',
    data: { created: ALFAMA, untouched: [] },
  });
  expect(io.files.get(ALFAMA)).toBe(alfamaNote);
  // One refresh found the activity; rememberCreated rebuilt the index once more.
  expect(state.refreshes).toBe(2);

  const missing = cliVault({
    [TRIP]: tripNote(),
  }, [TRIP]);
  const refusal = await refused(missing.io, 'ACTIVITY_NOT_FOUND', async () => createWith(missing.ctx, json({
    kind: 'planning',
    name: 'Alfama',
    trip: 'Lisbon',
    start: '2026-09-11',
    end: '2026-09-12',
    activities: [
      { name: 'Tram 28' },
    ],
  })));
  expect(refusal.error?.message).toContain('retry in a moment');
  expect(missing.state.refreshes).toBe(8);

  const twice = cliVault({
    [TRIP]: tripNote(),
    [TRAM]: activityNote(),
    'Travel/2026/Lisbon/Tram 28.md': activityNote(),
  }, [TRIP]);
  expect((await refused(twice.io, 'ACTIVITY_AMBIGUOUS', async () => createWith(twice.ctx, json({
    kind: 'planning',
    name: 'Alfama',
    trip: 'Lisbon',
    start: '2026-09-11',
    end: '2026-09-12',
    activities: [
      { name: 'Tram 28' },
    ],
  })))).error?.message).toContain(TRAM);
});

it('refuses an activity listed twice, and a setup that changed while the note was prepared', async () => {
  const { io, ctx, state } = cliVault({
    [TRIP]: tripNote(),
    [TRAM]: activityNote(),
  }, [TRIP]);
  const alfama = async (activities: unknown[]) => createWith(ctx, json({
    kind: 'planning',
    name: 'Alfama',
    trip: 'Lisbon',
    start: '2026-09-11',
    end: '2026-09-12',
    activities,
  }));
  const twice = await refused(io, 'INVALID_INPUT', async () => alfama([
    { name: 'Tram 28' },
    { name: TRAM, day: '2026-09-11' },
  ]));
  expect(twice.error?.message).toContain(`${TRAM} is listed more than once`);

  // Reading the day plan's template stands in for any await during which the user edits the setup.
  const read = io.read.bind(io);
  io.read = async (path: string) => {
    if (path === '_templates/Planning.md') {
      state.settings = {
        ...state.settings,
        profile: {
          ...state.settings.profile,
          types: state.settings.profile.types.map(type => type.id === 'planning'
            ? { ...type, label: 'Day' }
            : type),
        },
      };
    }
    return read(path);
  };
  expect((await refused(io, 'CHANGED', async () => alfama([
    { name: 'Tram 28', day: '2026-09-11' },
  ]))).error?.message).toContain('nothing was written');
  expect(io.files.has(ALFAMA)).toBe(false);
});

it('creates a trip, an activity and a day plan with the activity under its day, byte for byte', async () => {
  const { io, ctx, state } = cliVault();
  expect(await createWith(ctx, json({
    kind: 'advanced',
    name: 'Lisbon',
    start: '2026-09-10',
    end: '2026-09-13',
    fields: {
      Persons: ['Ana', 'Bo'],
    },
  }))).toEqual({
    apiVersion: 1,
    ok: true,
    command: 'trips:create',
    data: { created: TRIP, untouched: [] },
  });
  expect(io.files.get(TRIP)).toBe('---\n{"Persons":["Ana","Bo"],"Done":false,"banner":null,"base":"[[_templates/Bases/Travel.base]]","startDate":"2026-09-10","endDate":"2026-09-13"}\n---\n![[_templates/Bases/Planning.base]]\n');
  expect(state.settings.resolutions[TRIP]).toEqual({ typeId: 'advanced' });
  expect((await createWith(ctx, { kind: 'activity', name: 'Tram 28', trip: 'Lisbon' })).data).toEqual({ created: TRAM, untouched: [] });
  expect(io.files.get(TRAM)).toBe('---\n{"Location":null,"Done":false,"base":"[[_templates/Bases/Activities.base]]","backlink":"[[Lisbon]]"}\n---\nActivity\n');
  expect((await createWith(ctx, json({
    kind: 'planning',
    name: 'Alfama',
    trip: TRIP,
    start: '2026-09-11',
    end: '2026-09-12',
    activities: [
      { name: 'Tram 28', day: '2026-09-11' },
    ],
  }))).data).toEqual({ created: ALFAMA, untouched: [] });
  expect(io.files.get(ALFAMA)).toBe(alfamaNote);
  expect(io.writes).toEqual([TRIP, TRAM, ALFAMA]);
});

it('writes field values exactly as the form does for the same input', async () => {
  const fixture = (vault: ReturnType<typeof cliVault>) => {
    const activity = vault.state.settings.profile.types.find(type => type.id === 'activity')!;
    activity.fields.push(
      {
        key: 'Notes',
        label: 'Notes',
        type: 'text',
        required: false,
        defaultValue: 'tbd',
      },
      {
        key: 'Cost',
        label: 'Cost',
        type: 'number',
        required: false,
      },
      {
        key: 'Tags',
        label: 'Tags',
        type: 'text-list',
        required: false,
      },
      {
        key: 'Places',
        label: 'Places',
        type: 'note-link-list',
        required: false,
      },
    );
    vault.ctx.refresh();
    return activity;
  };
  const cli = cliVault({
    [TRIP]: tripNote(),
  }, [TRIP]);
  fixture(cli);
  const reply = await createWith(cli.ctx, json({
    kind: 'activity',
    name: 'Tram 28',
    trip: 'Lisbon',
    fields: {
      Location: '',
      Done: true,
      Cost: 12.5,
      Tags: ['old town', 'views'],
      Places: ['[[Alfama]]'],
    },
  }));
  expect(reply.ok).toBe(true);
  expect(cli.io.files.get(TRAM)).toBe('---\n{"Location":null,"Done":true,"Notes":"tbd","Cost":12.5,"Tags":["old town","views"],"Places":["[[Alfama]]"],"base":"[[_templates/Bases/Activities.base]]","backlink":"[[Lisbon]]"}\n---\nActivity\n');

  // The form holds every value as text, with list items on separate lines.
  const form = cliVault({
    [TRIP]: tripNote(),
  }, [TRIP]);
  const type = fixture(form);
  const draft = await buildDraft({
    type,
    name: 'Tram 28',
    fields: {
      Location: '',
      Done: 'true',
      Cost: '12.5',
      Tags: 'old town\nviews',
      Places: '[[Alfama]]',
    },
    parentPath: TRIP,
  }, {
    io: form.io,
    index: form.ctx.index(),
    types: form.state.settings.profile.types,
    linkText: form.ctx.linkText,
  });
  await applyCreation(form.io, await previewCreation(form.io, [draft]));
  expect(cli.io.files.get(TRAM)).toBe(form.io.files.get(TRAM));
});

it('reports a failed write with what was and wasn\'t written', async () => {
  const { io, ctx } = cliVault({
    [TRIP]: tripNote(),
  }, [TRIP]);
  io.failPath = TRAM;
  const before = new Map(io.files);
  const reply = await createWith(ctx, { kind: 'activity', name: 'Tram 28', trip: 'Lisbon' });
  expect(reply.ok).toBe(false);
  expect(reply.error).toEqual({
    code: 'WRITE_FAILED',
    message: `Write failed. ${TRAM} may exist partly written; check it before retrying.`,
    report: { completed: [], failed: TRAM, untouched: [] },
  });
  expect(io.files).toEqual(before);
});

it('still answers ok with a warning when the note was written but its kind could not be remembered', async () => {
  const { io, ctx } = cliVault();
  ctx.rememberCreated = async () => Promise.reject(new Error('Disk full'));
  const reply = await createWith(ctx, {
    kind: 'advanced',
    name: 'Lisbon',
    start: '2026-09-10',
    end: '2026-09-13',
  });
  expect(reply.ok).toBe(true);
  expect(reply.data?.created).toBe(TRIP);
  expect(reply.data?.warning).toContain('Disk full');
  expect(io.files.get(TRIP)).toBe('---\n{"Persons":[],"Done":false,"banner":null,"base":"[[_templates/Bases/Travel.base]]","startDate":"2026-09-10","endDate":"2026-09-13"}\n---\n![[_templates/Bases/Planning.base]]\n');
});

it('lists what each trip kind holds, falling back to the Bases its template embeds', async () => {
  const { ctx, state } = cliVault();
  const advanced = state.settings.profile.types.find(type => type.id === 'advanced')!;
  delete advanced.contains;
  ctx.templates.delete('_templates/Stop.md');
  const reply = await call('trips:kinds', () => kinds(ctx));
  const found = reply.data?.kinds as { id: string; contains?: string[]; templateMissing?: boolean; fields: unknown[] }[];
  expect(found.find(kind => kind.id === 'advanced')?.contains).toEqual(['planning']);
  expect(found.find(kind => kind.id === 'roadtrip')?.contains).toEqual(['stop']);
  expect(found.find(kind => kind.id === 'stop')?.templateMissing).toBe(true);
  expect(found.find(kind => kind.id === 'activity')).toEqual({
    id: 'activity',
    label: 'Activity',
    role: 'activity',
    dated: false,
    daySections: false,
    fields: [
      {
        key: 'Location',
        label: 'Location',
        type: 'text',
        required: false,
        default: null,
      },
      {
        key: 'Done',
        label: 'Done',
        type: 'boolean',
        required: false,
        default: false,
      },
    ],
  });
});

it('reports the same notes needing attention from status and list', async () => {
  const other = 'Travel/2027/Lisbon/Lisbon.md';
  const stray = 'Travel/2026/Lisbon/Activities/Stray.md';
  const { ctx } = cliVault({
    [TRIP]: tripNote(),
    [other]: tripNote('2027-09-10', '2027-09-13'),
    [stray]: activityNote(),
  }, [TRIP, other]);
  const expected = [
    {
      path: stray,
      label: 'Stray',
      context: 'Travel/2026/Lisbon/Activities',
      problem: 'Links to several trips; choose one',
    },
  ];
  expect((await call('trips:status', () => status(ctx))).data?.attention).toEqual(expected);
  expect((await call('trips:list', async () => list(ctx))).data?.attention).toEqual(expected);

  const clean = cliVault({
    [TRIP]: tripNote(),
    [TRAM]: activityNote(),
  }, [TRIP]);
  expect((await call('trips:status', () => status(clean.ctx))).data).toEqual({
    kinds: 6,
    folders: ['Travel'],
    trips: 1,
    attention: [],
    attentionHelp: 'Resolve these in Obsidian with the command "Review notes that need attention".',
  });
  expect((await call('trips:list', async () => list(clean.ctx))).data?.attention).toEqual([]);
});

it('lists trips with their day plans, the activities on each day, and where each activity is', async () => {
  const miradouro = 'Travel/2026/Lisbon/Activities/Miradouro.md';
  const { ctx } = cliVault({
    [TRIP]: tripNote(),
    [TRAM]: activityNote(),
    [miradouro]: activityNote(),
    [ALFAMA]: alfamaNote,
  }, [TRIP]);
  expect((await call('trips:list', async () => list(ctx))).data?.trips).toEqual([
    {
      path: TRIP,
      name: 'Lisbon',
      kind: 'advanced',
      start: '2026-09-10',
      end: '2026-09-13',
      entries: [
        {
          path: ALFAMA,
          name: 'Alfama',
          kind: 'planning',
          start: '2026-09-11',
          end: '2026-09-12',
          activities: ['Tram 28'],
          days: [
            {
              date: '2026-09-11',
              activities: ['Tram 28'],
            },
          ],
        },
      ],
      activities: [
        {
          path: miradouro,
          name: 'Miradouro',
          kind: 'activity',
          days: [],
        },
        {
          path: TRAM,
          name: 'Tram 28',
          kind: 'activity',
          days: [
            { entry: 'Alfama', date: '2026-09-11' },
          ],
        },
      ],
    },
  ]);
});
