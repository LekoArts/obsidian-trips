import { expect, it } from 'vitest';
import { language } from '../../../__tests__/obsidian';
import { dayLabel, freeStretch, linkResolver, neighbourDay, rangeLabel, shiftSpan, tripDays } from '../layout';
import { loadTrip } from './fixture';

const load = loadTrip;
it('rows are in date order with every day, its activities, and out-of-range links', async () => {
  const { layout } = await load({
    Busan: ['2026-05-10', '2026-05-12', '## 2026-05-11\n### Activities\n- [[Park]]\n## 2026-05-04\n### Activities\n- [[Park]]\n'],
    Arrival: ['2026-05-01', '2026-05-02'],
  });
  expect(layout.entries.map(row => row.name)).toEqual(['Arrival', 'Busan']);
  const busan = layout.entries[1]!;
  expect(busan.days.map(day => [
    day.date,
    day.activities.map(a => a.name),
  ])).toEqual([
    ['2026-05-10', []],
    [
      '2026-05-11',
      ['Park'],
    ],
    ['2026-05-12', []],
  ]);
  expect(busan.outside).toMatchObject([
    { date: '2026-05-04', name: 'Park', path: 'Travel/Park.md' },
  ]);
  expect(layout.unplanned.map(note => note.snapshot.path)).toEqual(['Travel/Idea.md']);
  expect(layout.attention).toEqual([]);
});
it('day headings in another date format are reported, so activities under them don\'t silently look unplanned', async () => {
  const { layout, model } = await load({
    Busan: ['2026-05-10', '2026-05-12', '## 10.05.2026\n### Activities\n- [[Park]]\n## 11.05.2026\n'],
    Arrival: ['2026-05-01', '2026-05-02', '## 2026-05-01\n### Activities\n- [[Idea]]\n'],
  });
  const label = model.entries[0]!.type.label;
  expect(layout.attention).toEqual([
    {
      name: 'Busan',
      path: 'Travel/Busan.md',
      message: `Day headings like 10.05.2026 aren’t read as days: set the ${label} day-heading format to DD.MM.YYYY in Trips settings.`,
    },
  ]);
  expect(layout.unplanned.map(note => note.snapshot.path)).toEqual(['Travel/Park.md']);
});
it('broken and out-of-trip dates are reported', async () => {
  const { layout } = await load({
    A: ['2026-05-10', '2026-05-12'],
    B: ['2026-05-12', '2026-05-14'],
    C: ['2026-05-13', '2026-05-15'],
    D: ['2026-05-20', '2026-05-18'],
    E: ['2026-06-02', '2026-06-03'],
  });
  expect(layout.entries.find(row => row.name === 'D')?.warnings).toEqual(['End date is before start date']);
  expect(layout.attention.map(item => `${item.name}: ${item.message}`)).toEqual(expect.arrayContaining(['D: End date is before start date', 'E: Outside the trip\'s dates (May 1\u2009–\u200931)']));
});
it('labels', () => {
  expect(dayLabel('2026-05-11')).toBe('Mon, May 11');
  expect(rangeLabel('2026-04-29', '2026-06-01')).toBe('Apr 29\u2009–\u2009Jun 1');
  expect(rangeLabel('2026-12-30', '2027-01-02')).toBe('Dec 30, 2026\u2009–\u2009Jan 2, 2027');
  expect(rangeLabel('2026-05-10', '2026-05-10')).toBe('May 10');
  expect(rangeLabel('', '')).toBe('No dates');
});
it('labels follow Obsidian\'s language', () => {
  language.value = 'de';
  try {
    expect(dayLabel('2026-05-11')).toBe('Mo., 11. Mai');
    expect(rangeLabel('2026-05-10', '2026-05-17')).toBe('10.–17. Mai');
  }
  finally { language.value = 'en'; }
});
it('activity links resolve like Obsidian links, and duplicate names stay unresolved rather than guessed', () => {
  const paths = [
    'Lisbon/Activities/Tram.md',
    'Porto/Activities/Tram.md',
    'Porto/Planning/Ribeira.md',
    'Lisbon/Planning/Ribeira.md',
    'Porto/Planning/Day.md',
    'Lisbon/Activities/Belém.md',
  ];
  const resolve = linkResolver(paths, 'Porto/Planning/Day.md');
  expect(resolve('[[Belém]]')).toBe('Lisbon/Activities/Belém.md');
  expect(resolve('[[Tram]]')).toBeUndefined();
  expect(resolve('[[Porto/Activities/Tram]]')).toBe('Porto/Activities/Tram.md');
  expect(resolve('[[Lisbon/Activities/Tram.md|the tram]]')).toBe('Lisbon/Activities/Tram.md');
  expect(resolve('[[Ribeira]]')).toBe('Porto/Planning/Ribeira.md');
  expect(resolve('[[Missing]]')).toBeUndefined();
});
it('the trip as days: every trip day once, entries stacked in start order, a changeover lists both', async () => {
  const { plan } = await load({
    A: ['2026-05-10', '2026-05-12', '## 2026-05-12\n### Activities\n- [[Park]]\n- [[Idea]]\n'],
    B: ['2026-05-12', '2026-05-14', '## 2026-05-12\n### Activities\n- [[Idea]]\n'],
    C: ['2026-05-13', '2026-05-15'],
    D: ['2026-05-20', '2026-05-18'],
  });
  expect(plan.days.map(day => day.date)).toHaveLength(31);
  expect(new Set(plan.days.map(day => day.date)).size).toBe(31);
  expect(plan.days[0]).toMatchObject({ date: '2026-05-01', slots: [] });
  const day = (date: string) => plan.days.find(d => d.date === date)!;
  // Changeover: A ends and B starts, both shown, each with its own activities in note order; not an overlap.
  expect(day('2026-05-12').slots.map(s => [
    s.row.name,
    s.first,
    s.last,
    s.activities.map(a => a.name),
  ])).toEqual([
    [
      'A',
      false,
      true,
      ['Park', 'Idea'],
    ],
    [
      'B',
      true,
      false,
      ['Idea'],
    ],
  ]);
  expect(day('2026-05-12').overlap).toBeUndefined();
  expect(day('2026-05-13').overlap).toBe('B and C overlap');
  // An entry keeps its tone on every day it covers; neighbours and overlaps differ.
  const tones = (name: string) => new Set(plan.days.flatMap(d => d.slots.filter(s => s.row.name === name).map(s => s.tone)));
  for (const name of ['A', 'B', 'C']) expect(tones(name).size).toBe(1);
  expect(tones('A')).not.toEqual(tones('B'));
  expect(tones('B')).not.toEqual(tones('C'));
  // An entry with broken dates has no bar.
  expect(plan.days.some(d => d.slots.some(s => s.row.name === 'D'))).toBe(false);
});
it('a long entry keeps its place on days a shorter one starts and ends inside it', async () => {
  const { plan } = await load({
    Short: ['2026-05-12', '2026-05-13'],
    Long: ['2026-05-10', '2026-05-20'],
  });
  const names = (date: string) => plan.days.find(d => d.date === date)!.slots.map(s => s.row.name);
  expect(names('2026-05-11')).toEqual(['Long']);
  expect(names('2026-05-12')).toEqual(['Long', 'Short']);
  expect(names('2026-05-13')).toEqual(['Long', 'Short']);
});
it('activities written for days the entry no longer covers show on that day, marked', async () => {
  const { plan } = await load({
    Busan: ['2026-05-10', '2026-05-11', '## 2026-05-04\n### Activities\n- [[Park]]\n'],
  });
  expect(plan.days.find(d => d.date === '2026-05-04')?.stray.map(s => [s.row.name, s.activity.name])).toEqual([
    ['Busan', 'Park'],
  ]);
});
it('activities written for dates outside the trip are listed, never dropped from every view', async () => {
  // Late runs past the trip (to 2 Jun) with an activity on 1 Jun; Busan has a stray link for 30 Apr.
  const { plan, layout } = await load({
    Late: ['2026-05-30', '2026-06-02', '## 2026-06-01\n### Activities\n- [[Park]]\n'],
    Busan: ['2026-05-10', '2026-05-11', '## 2026-04-30\n### Activities\n- [[Idea]]\n'],
  });
  expect(plan.beyond.map(item => [item.date, item.row.name, item.activity.name])).toEqual([
    ['2026-04-30', 'Busan', 'Idea'],
    ['2026-06-01', 'Late', 'Park'],
  ]);
  expect(plan.days.flatMap(day => day.stray)).toEqual([]);
  // Planned counts them, so they don't also show as "not on a day".
  expect(layout.unplanned).toEqual([]);
});
it('trip without valid dates has no days', async () => {
  const { layout, model } = await load({});
  expect(tripDays(layout, { ...model.trip, start: '2026-05-31', end: '2026-05-01' }).days).toEqual([]);
});
it('a new entry on a free day runs to the next entry\'s first day, or the trip\'s end', async () => {
  const { plan } = await load({
    A: ['2026-05-10', '2026-05-12'],
  });
  expect(freeStretch(plan, '2026-05-03')).toEqual({ start: '2026-05-03', end: '2026-05-10' });
  expect(freeStretch(plan, '2026-05-20')).toEqual({ start: '2026-05-20', end: '2026-05-31' });
});
it('day steps stay inside the entry and spans shift as a whole', async () => {
  const { layout } = await load({
    A: ['2026-05-10', '2026-05-12'],
  });
  const row = layout.entries[0]!;
  expect(neighbourDay(row, '2026-05-10', 1)).toBe('2026-05-11');
  expect(neighbourDay(row, '2026-05-12', 1)).toBeUndefined();
  expect(neighbourDay(row, '2026-05-10', -1)).toBeUndefined();
  expect(shiftSpan({ start: '2026-05-31', end: '2026-06-01' }, 1)).toEqual({ start: '2026-06-01', end: '2026-06-02' });
});
