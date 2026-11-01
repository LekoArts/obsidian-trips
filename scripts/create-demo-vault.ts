/**
 * Build the demo vault used to check the plugin by hand in Obsidian.
 *
 * The vault is realistic rather than exhaustive, and it covers the cases the
 * itinerary view has to handle: a 34-day advanced trip with changeover days,
 * one overlap, one free day, activities on days and off days, an activity
 * dated outside its entry, an activity outside the trip, an ambiguous link and
 * a link to a note that does not exist. Next to it: a roadtrip with a free day
 * and no activities, and simple trips from several years.
 *
 * Templates and Bases are taken from the plugin's own preset, so this never
 * drifts from what "Install the travel preset" writes into a vault.
 *
 * Usage: node scripts/create-demo-vault.ts [target] [--force]
 */
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { presetFiles } from '../src/config/bundled-preset.ts';

interface DayPlan {
  /** ISO date. */
  date: string;
  notes?: string[];
  activities?: string[];
}

interface PlanSpec {
  name: string;
  start: string;
  end: string;
  days?: DayPlan[];
  /** Activities on the entry's list that no day shows. */
  loose?: string[];
}

interface SimpleTrip {
  name: string;
  start: string;
  end: string;
  folder: string;
}

const TRIP = {
  name: 'Singapore & South Korea',
  folder: 'Travel/2026/Singapore & South Korea',
  start: '2026-04-29',
  end: '2026-06-01',
};

const ROADTRIP = {
  name: 'Coast Road',
  folder: 'Travel/2026/Coast Road',
  start: '2026-07-01',
  end: '2026-07-08',
};

const PLANS: PlanSpec[] = [
  {
    name: 'Singapore',
    start: '2026-04-29',
    end: '2026-05-02',
    days: [
      {
        date: '2026-04-29',
        notes: ['Arrive at Changi Airport', 'Evening at Marina Bay'],
        activities: ['Gardens by the Bay'],
      },
      {
        date: '2026-04-30',
        notes: ['Lunch at a hawker centre'],
        activities: ['Chinatown', 'Clarke Quay'],
      },
      {
        date: '2026-05-01',
        notes: ['Day trip to Sentosa'],
        activities: ['Sentosa'],
      },
    ],
    loose: ['Merlion'],
  },
  {
    name: 'Seoul',
    start: '2026-05-02',
    end: '2026-05-09',
    days: [
      {
        date: '2026-05-02',
        notes: ['Flight SIN → ICN', 'Transfer to the hotel'],
        activities: ['Namsan Tower'],
      },
      {
        date: '2026-05-03',
        notes: ['Bukchon Hanok Village', 'Café day in Ikseondong'],
        activities: ['Bukchon'],
      },
      {
        date: '2026-05-05',
        activities: ['Gyeongbokgung'],
      },
      {
        date: '2026-05-08',
        notes: ['Last evening in Seoul'],
        activities: ['Hongdae Street Food'],
      },
    ],
    loose: ['Photo Spots', 'Gwangjang Market'],
  },
  {
    name: 'Busan',
    start: '2026-05-09',
    end: '2026-05-16',
    days: [
      {
        date: '2026-05-09',
        notes: ['KTX from Seoul to Busan'],
        activities: ['Gamcheon Culture Village'],
      },
      {
        date: '2026-05-10',
        activities: ['Haedong Yonggungsa Temple', 'Haeundae Sky Capsule'],
      },
      {
        date: '2026-05-12',
        activities: ['Gwangalli Beach'],
      },
      {
        date: '2026-05-14',
        activities: ['Taejongdae'],
      },
      {
        date: '2026-05-15',
        notes: ['Work from the hotel'],
        activities: ['SPA LAND Centum City'],
      },
      // Written for a day after the entry ends: it belongs to no day of this entry.
      {
        date: '2026-05-18',
        activities: ['Huinnyeoul Culture Village'],
      },
    ],
    loose: ['Busan Street Food', 'Millak Waterside Park', 'Busan - Photos'],
  },
  {
    name: 'Gyeongju',
    start: '2026-05-16',
    end: '2026-05-18',
    days: [
      {
        date: '2026-05-16',
        notes: ['Train to Gyeongju'],
        activities: ['Bulguksa'],
      },
      {
        date: '2026-05-17',
        activities: ['Daereungwon Tombs'],
      },
    ],
    loose: ['Wolji Pond', 'Gyeongju - Photos'],
  },
  {
    // Starts before Gyeongju ends: the two entries overlap for two days.
    name: 'Jeju',
    start: '2026-05-17',
    end: '2026-05-21',
    days: [
      {
        date: '2026-05-18',
        notes: ['Flight to Jeju'],
        activities: ['Seongsan Ilchulbong'],
      },
      {
        date: '2026-05-19',
        activities: ['Manjanggul Cave'],
      },
      {
        date: '2026-05-20',
        activities: ['Hallasan Hike'],
      },
    ],
  },
  {
    name: 'Seoul Again',
    start: '2026-05-21',
    end: '2026-05-27',
    days: [
      {
        date: '2026-05-21',
        notes: ['Flight back to Seoul'],
      },
      {
        date: '2026-05-22',
        activities: ['Changdeokgung'],
      },
      {
        date: '2026-05-24',
        activities: ['Insadong', 'Ikseon Hanok Village'],
      },
      // After the trip ends: shows up under "Outside the trip".
      {
        date: '2026-06-02',
        activities: ['Incheon Airport Transfer'],
      },
    ],
    loose: ['Cheonggyecheon Stream', 'Seoul - Photos'],
  },
  {
    name: 'Sokcho',
    start: '2026-05-27',
    end: '2026-05-29',
    days: [
      {
        date: '2026-05-27',
        notes: ['Bus to Sokcho'],
        activities: ['Seoraksan National Park'],
      },
    ],
    loose: ['Sokcho - Photos'],
  },
  {
    // The trip runs to 1 Jun; 30 May belongs to no entry.
    name: 'Seoul Departure',
    start: '2026-05-31',
    end: '2026-06-01',
    days: [
      {
        date: '2026-05-31',
        notes: ['Back to Seoul'],
      },
      {
        date: '2026-06-01',
        notes: ['Flight ICN → FRA'],
      },
    ],
  },
];

const STOPS: PlanSpec[] = [
  {
    name: 'Porto',
    start: '2026-07-01',
    end: '2026-07-03',
    loose: ['Ribeira'],
  },
  { name: 'Coimbra', start: '2026-07-03', end: '2026-07-04' },
  { name: 'Lagos', start: '2026-07-06', end: '2026-07-08' },
];

const SIMPLE_TRIPS: SimpleTrip[] = [
  {
    name: 'Lisbon',
    folder: 'Travel/2019',
    start: '2019-05-01',
    end: '2019-05-08',
  },
  {
    name: 'Rome',
    folder: 'Travel/2022',
    start: '2022-09-10',
    end: '2022-09-17',
  },
  {
    name: 'Kyoto',
    folder: 'Travel/2023',
    start: '2023-04-02',
    end: '2023-04-12',
  },
  {
    name: 'Oslo',
    folder: 'Travel/2024',
    start: '2024-06-20',
    end: '2024-06-25',
  },
  {
    name: 'Porto',
    folder: 'Travel/2025',
    start: '2025-03-01',
    end: '2025-03-06',
  },
];

/** Same name in two trips: `[[Photo Spots]]` resolves to neither. */
const DUPLICATE_NAMES = ['Photo Spots'];

/** Linked from a plan, but no note has this name. */
const MISSING_NOTES = ['Cheonggyecheon Stream', 'Ikseon Hanok Village'];

const files = new Map<string, string>();

function flights(start: string, end: string): string {
  return [
    '> [!info]- Flights',
    '> **Outbound**',
    '> ',
    `> ${start}`,
    '> LH123',
    '> FRA 12:15 - SIN 06:50 (12h 35min)',
    '> ',
    '> **Return**',
    '> ',
    `> ${end}`,
    '> LH124',
    '> ICN 12:10 - FRA 18:15 (13h 05min)',
  ].join('\n');
}

function frontMatter(entries: (string | null)[]): string[] {
  return [
    '---',
    ...entries.filter(line => line !== null),
    '---',
  ];
}

function linkList(property: string, links: string[]): string[] {
  if (links.length === 0)
    return [`${property}:`];
  return [
    `${property}:`,
    ...links.map(link => `  - "[[${link}]]"`),
  ];
}

function planBody(plan: PlanSpec): string {
  const sections = (plan.days ?? []).map((day) => {
    const lines = [`## ${day.date}`];
    const notes = day.notes ?? [];
    const activities = day.activities ?? [];
    if (notes.length > 0)
      lines.push('', ...notes.map(note => `- ${note}`));
    if (activities.length > 0)
      lines.push('', '### Activities', '', ...activities.map(activity => `- [[${activity}]]`));
    return lines.join('\n');
  });
  return sections.length
    ? `\n\n${sections.join('\n\n')}\n`
    : '\n';
}

function planNote(tripName: string, plan: PlanSpec): string {
  const linked = [
    ...new Set([
      ...(plan.days ?? []).flatMap(day => day.activities ?? []),
      ...plan.loose ?? [],
    ]),
  ];
  const head = frontMatter([
    'base: "[[_templates/Bases/Planning.base]]"',
    `backlink: "[[${tripName}]]"`,
    `startDate: ${plan.start}`,
    `endDate: ${plan.end}`,
    ...linkList('Activities', linked),
  ]);
  return `${head.join('\n')}${planBody(plan)}`;
}

function activityNote(parent: string, place: string): string {
  return `${frontMatter([
    'base: "[[_templates/Bases/Activities.base]]"',
    `backlink: "[[${parent}]]"`,
    `Location: ${place}`,
    'Done: false',
  ]).join('\n')}\n`;
}

function tripNote(trip: { name: string; start: string; end: string }, kind: 'simple' | 'advanced' | 'roadtrip'): string {
  const head = frontMatter([
    'base: "[[_templates/Bases/Travel.base]]"',
    `startDate: ${trip.start}`,
    `endDate: ${trip.end}`,
    'Persons: []',
    'Done: false',
  ]);
  const blocks = [
    '## Shortcuts',
    '',
    flights(trip.start, trip.end),
  ];
  if (kind === 'advanced') {
    blocks.push('', '## Itinerary', '', '![[_templates/Bases/Planning.base]]', '', '## Activities', '', '![[_templates/Bases/Activities.base]]');
  }
  else if (kind === 'roadtrip') {
    blocks.push('', '## Itinerary', '', '![[_templates/Bases/Roadtrip.base]]');
  }
  return `${head.join('\n')}\n\n${blocks.join('\n')}\n`;
}

function stopNote(tripName: string, stop: PlanSpec): string {
  const head = frontMatter([
    'base: "[[_templates/Bases/Roadtrip.base]]"',
    `backlink: "[[${tripName}]]"`,
    `startDate: ${stop.start}`,
    `endDate: ${stop.end}`,
    ...linkList('Activities', stop.loose ?? []),
  ]);
  return `${head.join('\n')}\n\n## Location\n\n**${stop.name}**\n\nAddress\nCheck-in / Check-out: 15:00 / 11:00\n\n## Activities\n\n${(stop.loose ?? []).map(name => `- [[${name}]]`).join('\n') || 'TBD'}\n`;
}

function addTrip(plans: PlanSpec[], trip: { name: string; folder: string; start: string; end: string }, kind: 'advanced' | 'roadtrip', childFolder: string): void {
  files.set(`${trip.folder}/${trip.name}.md`, tripNote(trip, kind));
  for (const plan of plans) {
    files.set(`${trip.folder}/${childFolder}/${plan.name}.md`, kind === 'roadtrip'
      ? stopNote(trip.name, plan)
      : planNote(trip.name, plan));
    for (const activity of [
      ...(plan.days ?? []).flatMap(day => day.activities ?? []),
      ...plan.loose ?? [],
    ]) {
      if (MISSING_NOTES.includes(activity))
        continue;
      files.set(`${trip.folder}/Activities/${activity}.md`, activityNote(trip.name, plan.name));
    }
  }
}

function addSimpleTrips(): void {
  for (const trip of SIMPLE_TRIPS) {
    files.set(`${trip.folder}/${trip.name}.md`, tripNote(trip, 'simple'));
  }
}

function addDuplicateActivity(): void {
  const copies: [string, string, string][] = [
    [TRIP.folder, TRIP.name, 'Seoul'],
    [ROADTRIP.folder, ROADTRIP.name, 'Porto'],
  ];
  for (const name of DUPLICATE_NAMES) {
    for (const [folder, tripName, place] of copies)
      files.set(`${folder}/Activities/${name}.md`, activityNote(tripName, place));
  }
}

function addHome(): void {
  const lines = [
    '# Home',
    '',
    'Trips in this vault:',
    '',
    `- [[${TRIP.name}]]`,
    `- [[${ROADTRIP.name}]]`,
    ...SIMPLE_TRIPS.map(trip => `- [[${trip.name}]]`),
  ];
  files.set('Home.md', `${lines.join('\n')}\n`);
}

function addPreset(): void {
  for (const file of presetFiles) files.set(file.path, file.content);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  }
  catch {
    return false;
  }
}

async function write(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

function parseArgs(argv: string[]): { target: string; force: boolean } {
  const force = argv.includes('--force');
  const target = argv.find(arg => !arg.startsWith('--')) ?? 'assets/demo-vault';
  return {
    target: resolve(target),
    force,
  };
}

const ROOT = resolve(import.meta.dirname, '..');

async function copyPlugin(target: string): Promise<string[]> {
  const copied: string[] = [];
  for (const name of ['main.js', 'manifest.json', 'styles.css']) {
    const source = join(ROOT, name);
    if (!(await exists(source)))
      continue;
    const destination = join(target, '.obsidian/plugins/trips', name);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    copied.push(name);
  }
  return copied;
}

async function main(): Promise<void> {
  const { target, force } = parseArgs(process.argv.slice(2));
  if (await exists(target)) {
    if (!force)
      throw new Error(`${target} already exists. Pass --force to replace it.`);
    await rm(target, { recursive: true, force: true });
  }

  addPreset();
  addTrip(PLANS, TRIP, 'advanced', 'Planning');
  addTrip(STOPS, ROADTRIP, 'roadtrip', 'Stops');
  addSimpleTrips();
  addDuplicateActivity();
  addHome();

  for (const [path, content] of files) await write(join(target, path), content);

  await write(join(target, '.obsidian/app.json'), `${JSON.stringify({ alwaysUpdateLinks: true }, null, 2)}\n`);
  await write(join(target, '.obsidian/core-plugins.json'), `${JSON.stringify([
    'bases',
    'file-explorer',
    'global-search',
    'switcher',
    'page-preview',
    'command-palette',
    'outline',
    'backlink',
  ], null, 2)}\n`);
  await write(join(target, '.obsidian/community-plugins.json'), `${JSON.stringify(['trips'], null, 2)}\n`);

  const plugin = await copyPlugin(target);
  const pluginLine = plugin.length > 0
    ? `  plugin: ${plugin.join(', ')}`
    : '  plugin: not copied (run `pnpm build` first)';
  process.stdout.write([
    `Created ${target}`,
    `  ${files.size} files: ${SIMPLE_TRIPS.length + 2} trips, ${PLANS.length + STOPS.length} entries`,
    pluginLine,
    '',
    'Open the folder as a vault in Obsidian, then install the travel preset in Settings → Trips.',
    '',
  ].join('\n'));
}

await main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error
    ? error.message
    : String(error)}\n`);
  process.exitCode = 1;
});
