import type { ItineraryDataHost } from '../model';
import { expect, it } from 'vitest';
import { emptySettings, newType } from '../../../config/profile';
import { parseProperties, splitNote } from '../../../config/template-render';
import { buildIndex } from '../../../discovery';
import { undoPlan } from '../../../editing/batch';
import { TestVault } from '../../../editing/test-vault';
import { loadItinerary } from '../model';
import { applyPlan, assignmentPlan, combine, extensionPlan, OutsideTrip, removalPlan, spanPlan } from '../operations';

async function setup() {
  const vault = new TestVault();
  const io = Object.assign(vault, {
    paths: () => [
      ...vault.files.keys(),
    ],
  });
  const settings = emptySettings();
  settings.profile.types = [
    newType('trip'),
    newType('entry', 'entry'),
    newType('activity', 'activity'),
  ];
  io.files.set('Travel/Trip.md', io.note({ kind: 'trip', startDate: '2026-05-01', endDate: '2026-05-31' }));
  io.files.set('Travel/Entry.md', io.note({
    kind: 'entry',
    backlink: '[[Travel/Trip.md]]',
    startDate: '2026-05-27',
    endDate: '2026-05-29',
    unknown: 'kept',
  }, 'Intro\n## 2026-05-27\nProse\n### Activities\n- [[Travel/Activity.md]]\n'));
  io.files.set('Travel/Activity.md', io.note({ kind: 'activity', backlink: '[[Travel/Trip.md]]' }));
  const host: ItineraryDataHost = { io, settings, index: [] };
  function rebuild() {
    host.index = buildIndex(settings.profile, [...io.files].map(([path, content]) => ({
      path,
      properties: parseProperties(splitNote(content).yaml, io.codec),
    })), io.paths(), settings.resolutions);
  }
  rebuild();
  const model = await loadItinerary(host, 'Travel/Trip.md');
  return {
    io,
    host,
    model,
    rebuild,
    entry: model.entries[0]!,
    activity: 'Travel/Activity.md',
  };
}
it('new dates for one entry change only its dates; body and unknown fields stay', async () => {
  const { io, host, model, entry } = await setup();
  const plan = spanPlan(model, entry, { start: '2026-05-28', end: '2026-05-30' });
  expect(io.writes).toEqual([]);
  expect((await applyPlan(host, model, plan)).failed).toBeUndefined();
  expect(io.writes).toEqual([entry.snapshot.path]);
  const result = splitNote(await io.read(entry.snapshot.path));
  expect(result.body).toBe(splitNote(entry.snapshot.content).body);
  expect(parseProperties(result.yaml, io.codec)).toEqual({ ...entry.properties, startDate: '2026-05-28', endDate: '2026-05-30' });
});
it('missing-section assignment previews then applies membership and body in one write', async () => {
  const { io, host, model, entry, activity } = await setup();
  const plan = assignmentPlan(host, model, entry, { action: 'day-add', day: '2026-05-28', target: activity });
  expect(io.writes).toEqual([]);
  expect(plan.addedSection).toBe(true);
  expect(plan.steps[0]?.summary).toContain('Added a Thu, May 28 → Activities section to Entry');
  await applyPlan(host, model, plan);
  expect(io.writes).toEqual([entry.snapshot.path]);
  const result = splitNote(await io.read(entry.snapshot.path));
  expect(result.body).toContain(splitNote(entry.snapshot.content).body);
  expect(result.body).toContain('## 2026-05-28');
  expect(parseProperties(result.yaml, io.codec).Activities).toEqual([`[[${activity.replace(/^.*\//, '').replace(/\.md$/, '')}]]`]);
});
it('body-only daily removal preserves original frontmatter bytes and full removal enumerates links', async () => {
  const { io, host, model, entry, activity } = await setup();
  const full = assignmentPlan(host, model, entry, { action: 'full-remove', target: activity });
  expect(full.steps[0]?.summary).toBe('Removed Activity from Entry. The activity note stays.');
  const plan = assignmentPlan(host, model, entry, { action: 'day-remove', day: '2026-05-27', target: activity });
  await applyPlan(host, model, plan);
  const before = splitNote(entry.snapshot.content);
  const after = splitNote(await io.read(entry.snapshot.path));
  expect(after.yaml).toBe(before.yaml);
  expect(after.body).toContain('Prose\n');
  expect(after.body).not.toContain('- [[');
});
it('configuration, recognition selection, stale source and unsaved buffer block confirmation', async () => {
  const { io, host, model, entry } = await setup();
  const plan = spanPlan(model, entry, { start: '2026-05-28', end: '2026-05-30' });
  host.settings.resolutions[entry.snapshot.path] = { typeId: 'entry' };
  await expect(applyPlan(host, model, plan)).rejects.toThrow('Configuration changed');
  host.settings.resolutions = {};
  io.editors.set(entry.snapshot.path, ['Unsaved draft']);
  expect((await applyPlan(host, model, plan)).failed).toBe(entry.snapshot.path);
  io.editors.clear();
  io.files.set(model.trip.snapshot.path, 'Changed trip');
  expect((await applyPlan(host, model, plan)).failed).toBe(model.trip.snapshot.path);
  expect(io.writes).toEqual([]);
});
it('undo puts bytes back even when the note no longer fits the open trip context', async () => {
  const { io, host, model, entry } = await setup();
  const plan = spanPlan(model, entry, { start: '2026-05-28', end: '2026-05-30' });
  await applyPlan(host, model, plan);
  // The index stopped recognising the entry (its kind was edited elsewhere), so a fresh change would be refused.
  host.index = host.index.filter(note => note.path !== entry.snapshot.path);
  await expect(applyPlan(host, model, spanPlan(model, entry, { start: '2026-05-29', end: '2026-05-30' }))).rejects.toThrow('Recognition');
  expect((await applyPlan(host, model, undoPlan(plan))).completed).toEqual([entry.snapshot.path]);
  expect(await io.read(entry.snapshot.path)).toBe(entry.snapshot.content);
});
it('detach and reattach preserve body and trash never cascades', async () => {
  const { io, host, model, entry, rebuild } = await setup();
  const detached = removalPlan(host, model, entry, 'detach');
  expect(detached.steps[0]?.summary).toContain('Base');
  await applyPlan(host, model, detached);
  rebuild();
  const next = await loadItinerary(host, model.trip.snapshot.path);
  expect(next.detached.map(note => note.snapshot.path)).toContain(entry.snapshot.path);
  await applyPlan(host, next, removalPlan(host, next, next.detached[0]!, 'attach'));
  rebuild();
  expect(splitNote(await io.read(entry.snapshot.path)).body).toBe(splitNote(entry.snapshot.content).body);
  const attached = await loadItinerary(host, model.trip.snapshot.path);
  await applyPlan(host, attached, removalPlan(host, attached, attached.trip, 'trash'));
  expect(io.exists(entry.snapshot.path)).toBe(true);
  expect(io.exists('Travel/Activity.md')).toBe(true);
  await expect(loadItinerary(host, model.trip.snapshot.path)).rejects.toThrow();
});
it('the result line names the new dates, the body-date reminder and activities left outside', async () => {
  const { model, entry } = await setup();
  expect(spanPlan(model, entry, { start: '2026-05-28', end: '2026-05-30' }).steps[0]?.summary).toBe('Entry now May 28\u2009–\u200930. Dates written inside the note weren\'t changed. 1 activity is on days outside it now.');
  expect(spanPlan(model, entry, { start: '2026-05-27', end: '2026-05-30' }).steps[0]?.summary).toBe('Entry now May 27\u2009–\u200930. Dates written inside the note weren\'t changed.');
  expect(() => spanPlan(model, entry, { start: '2026-05-30', end: '2026-05-29' })).toThrow('ends on or after');
});
it('leaving the trip is refused with the range needed; with extend, trip and entry change together', async () => {
  const { io, host, model, entry } = await setup();
  let error: unknown;
  try {
    spanPlan(model, entry, { start: '2026-06-01', end: '2026-06-03' });
  }
  catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(OutsideTrip);
  expect((error as OutsideTrip).range).toEqual({ start: '2026-05-01', end: '2026-06-03' });
  const plan = spanPlan(model, entry, { start: '2026-06-01', end: '2026-06-03' }, true);
  expect(plan.steps.map(step => step.before.path)).toEqual([model.trip.snapshot.path, entry.snapshot.path]);
  await applyPlan(host, model, plan);
  expect(parseProperties(splitNote(await io.read(model.trip.snapshot.path)).yaml, io.codec)).toMatchObject({ startDate: '2026-05-01', endDate: '2026-06-03' });
  expect(parseProperties(splitNote(await io.read(entry.snapshot.path)).yaml, io.codec)).toMatchObject({ startDate: '2026-06-01', endDate: '2026-06-03' });
  expect(() => extensionPlan(model, '2026-05-02', '2026-05-31')).toThrow('narrow');
});
it('reordering a day moves only that bullet; the rest of the body is byte-identical', async () => {
  const { io, host, model, rebuild } = await setup();
  io.files.set('Travel/Second.md', io.note({ kind: 'activity', backlink: '[[Travel/Trip.md]]' }));
  io.files.set('Travel/Third.md', io.note({ kind: 'activity', backlink: '[[Travel/Trip.md]]' }));
  const body = 'Intro\n## 2026-05-27\nProse\n### Activities\n- [[Activity]]\n- [[Second]]\n- [[Third]]\n\n## 2026-05-28\nMore\n';
  io.files.set('Travel/Entry.md', io.note({
    kind: 'entry',
    backlink: '[[Trip]]',
    startDate: '2026-05-27',
    endDate: '2026-05-29',
    Activities: ['[[Activity]]', '[[Second]]', '[[Third]]'],
  }, body));
  rebuild();
  const next = await loadItinerary(host, model.trip.snapshot.path);
  const entry = next.entries[0]!;
  const before = io.files.get('Travel/Entry.md')!;
  await applyPlan(host, next, assignmentPlan(host, next, entry, {
    action: 'reassign',
    target: 'Travel/Third.md',
    fromDay: '2026-05-27',
    day: '2026-05-27',
    index: 0,
  }));
  expect(io.files.get('Travel/Entry.md')).toBe(before.replace('- [[Activity]]\n- [[Second]]\n- [[Third]]\n', '- [[Third]]\n- [[Activity]]\n- [[Second]]\n'));
});
it('undo puts back exact bytes of every written file, and refuses when a file changed since', async () => {
  const { io, host, model, entry, activity, rebuild } = await setup();
  const originalEntry = io.files.get(entry.snapshot.path)!;
  const originalTrip = io.files.get(model.trip.snapshot.path)!;
  const plan = spanPlan(model, entry, { start: '2026-06-01', end: '2026-06-03' }, true);
  await applyPlan(host, model, plan);
  rebuild();
  const undo = undoPlan(plan);
  expect((await applyPlan(host, await loadItinerary(host, model.trip.snapshot.path), undo)).failed).toBeUndefined();
  expect(io.files.get(entry.snapshot.path)).toBe(originalEntry);
  expect(io.files.get(model.trip.snapshot.path)).toBe(originalTrip);
  // A later external edit wins: Undo writes nothing and names the file.
  rebuild();
  const again = await loadItinerary(host, model.trip.snapshot.path);
  const second = assignmentPlan(host, again, again.entries[0]!, { action: 'day-remove', day: '2026-05-27', target: activity });
  await applyPlan(host, again, second);
  io.files.set(entry.snapshot.path, `${io.files.get(entry.snapshot.path)}typed later\n`);
  const edited = io.files.get(entry.snapshot.path);
  rebuild();
  const report = await applyPlan(host, await loadItinerary(host, model.trip.snapshot.path), undoPlan(second));
  expect(report.failed).toBe(entry.snapshot.path);
  expect(io.files.get(entry.snapshot.path)).toBe(edited);
});
it('a combined change writes both files in order and undoes as one', async () => {
  const { io, host, model, activity, rebuild } = await setup();
  io.files.set('Travel/Other.md', io.note({
    kind: 'entry',
    backlink: '[[Trip]]',
    startDate: '2026-05-10',
    endDate: '2026-05-11',
  }));
  rebuild();
  const next = await loadItinerary(host, model.trip.snapshot.path);
  const [other, entry] = [
    next.entries.find(e => e.snapshot.path === 'Travel/Other.md')!,
    next.entries.find(e => e.snapshot.path === 'Travel/Entry.md')!,
  ];
  const before = new Map(io.files);
  const plan = combine([
    assignmentPlan(host, next, entry, { action: 'day-remove', day: '2026-05-27', target: activity }),
    assignmentPlan(host, next, other, { action: 'day-add', day: '2026-05-10', target: activity }),
  ]);
  await applyPlan(host, next, plan);
  expect(io.files.get('Travel/Entry.md')).not.toContain('- [[');
  expect(io.files.get('Travel/Other.md')).toContain('- [[Activity]]');
  rebuild();
  await applyPlan(host, await loadItinerary(host, model.trip.snapshot.path), undoPlan(plan));
  expect(io.files).toEqual(before);
});
it('an empty trip offers the entry kinds its embedded Bases contain; existing entries add theirs', async () => {
  const { io, host, rebuild } = await setup();
  const [trip, entry, activityType] = host.settings.profile.types;
  const stop = {
    ...newType('stop', 'entry'),
    label: 'Stop',
    basePath: '_templates/Bases/Roadtrip.base',
  };
  entry!.basePath = '_templates/Bases/Planning.base';
  activityType!.basePath = '_templates/Bases/Activities.base';
  host.settings.profile.types.push(stop);
  io.files.set('Travel/Empty.md', io.note({ kind: 'trip', startDate: '2026-06-01', endDate: '2026-06-05' }, '![[Roadtrip.base]]\n'));
  rebuild();
  const empty = await loadItinerary(host, 'Travel/Empty.md');
  expect(empty.kinds.map(type => type.id)).toEqual(['stop']);
  expect(empty.activityKind).toBeUndefined();
  // No embed in the note: the trip kind's template decides.
  io.files.set('Travel/Bare.md', io.note({ kind: 'trip', startDate: '2026-06-01', endDate: '2026-06-05' }));
  io.files.set('_templates/Trip.md', '![[_templates/Bases/Planning.base]]\n');
  trip!.template = '_templates/Trip.md';
  rebuild();
  expect((await loadItinerary(host, 'Travel/Bare.md')).kinds.map(type => type.id)).toEqual(['entry']);
  // The original trip embeds nothing and has no template content, but already has an entry.
  trip!.template = '_templates/Missing.md';
  const populated = await loadItinerary(host, 'Travel/Trip.md');
  expect(populated.kinds.map(type => type.id)).toEqual(['entry']);
  expect(populated.activityKind?.id).toBe('activity');
});
it('kinds without a Base are always offered; existing undated entries and activity kinds keep their section', async () => {
  const { io, host, rebuild } = await setup();
  const [, entry, activityType] = host.settings.profile.types;
  // Base-free custom setup: an empty trip still offers its entry and activity kinds.
  io.files.set('Travel/Empty.md', io.note({ kind: 'trip', startDate: '2026-06-01', endDate: '2026-06-05' }));
  rebuild();
  const empty = await loadItinerary(host, 'Travel/Empty.md');
  expect(empty.kinds.map(type => type.id)).toEqual(['entry']);
  expect(empty.activityKind?.id).toBe('activity');
  // An entry kind switched to undated, with a Base the trip doesn't embed, still shows its existing notes.
  entry!.dated = false;
  entry!.basePath = '_templates/Bases/Planning.base';
  rebuild();
  expect((await loadItinerary(host, 'Travel/Trip.md')).kinds.map(type => type.id)).toEqual(['entry']);
  // Two activity kinds with Bases: the one the trip's activities use wins over profile order.
  activityType!.basePath = '_templates/Bases/Activities.base';
  const sight = {
    ...newType('sight', 'activity'),
    basePath: '_templates/Bases/Sights.base',
  };
  host.settings.profile.types.splice(2, 0, sight);
  rebuild();
  expect((await loadItinerary(host, 'Travel/Trip.md')).activityKind?.id).toBe('activity');
});
it('an explicit Contains list limits what can be created, but existing notes of other kinds still show', async () => {
  const { host, rebuild } = await setup();
  const [trip] = host.settings.profile.types;
  trip!.contains = [];
  rebuild();
  const closed = await loadItinerary(host, 'Travel/Trip.md');
  expect(closed.kinds.map(type => type.id)).toEqual(['entry']);
  expect(closed.creatable).toEqual([]);
  expect(closed.activityKind).toBeUndefined();
  trip!.contains = ['entry', 'activity'];
  rebuild();
  const open = await loadItinerary(host, 'Travel/Trip.md');
  expect(open.creatable).toEqual(['entry']);
  expect(open.activityKind?.id).toBe('activity');
});
it('a note recognised differently since loading (other kind or trip) blocks writing, even with the same bytes and settings', async () => {
  const { io, host, model, entry } = await setup();
  const plan = spanPlan(model, entry, { start: '2026-05-28', end: '2026-05-30' });
  const indexed = host.index.find(note => note.path === entry.snapshot.path)!;
  for (const change of [
    { typeId: 'activity' },
    { parentPath: 'Travel/Other trip.md' },
  ]) {
    const original = { ...indexed };
    Object.assign(indexed, change);
    await expect(applyPlan(host, model, plan)).rejects.toThrow('Recognition or parent context changed');
    Object.assign(indexed, original);
  }
  expect(io.writes).toEqual([]);
});
