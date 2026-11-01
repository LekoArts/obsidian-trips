import type { ItineraryDataHost } from '../model';
import { emptySettings, newType } from '../../../config/profile';
import { parseProperties, splitNote } from '../../../config/template-render';
import { buildIndex } from '../../../discovery';
import { TestVault } from '../../../editing/test-vault';
import { tripDays, tripLayout } from '../layout';
import { loadItinerary } from '../model';

/** A 1–31 May trip with activities Park and Idea, plus the given entries: name → [start, end, body, frontmatter extras]. */
export async function loadTrip(entries: Record<string, [string, string, string?, Record<string, unknown>?]>) {
  const io = Object.assign(new TestVault(), {
    paths: () => [
      ...io.files.keys(),
    ],
  });
  const settings = emptySettings();
  settings.profile.types = [
    newType('trip'),
    newType('entry', 'entry'),
    newType('activity', 'activity'),
  ];
  io.files.set('Travel/Trip.md', io.note({ kind: 'trip', startDate: '2026-05-01', endDate: '2026-05-31' }));
  io.files.set('Travel/Park.md', io.note({ kind: 'activity', backlink: '[[Travel/Trip.md]]' }));
  io.files.set('Travel/Idea.md', io.note({ kind: 'activity', backlink: '[[Travel/Trip.md]]' }));
  for (const [name, [start, end, body, extra]] of Object.entries(entries)) {
    io.files.set(`Travel/${name}.md`, io.note({
      kind: 'entry',
      backlink: '[[Travel/Trip.md]]',
      startDate: start,
      endDate: end,
      ...extra,
    }, body ?? ''));
  }
  const host: ItineraryDataHost = { io, settings, index: [] };
  async function reload() {
    host.index = buildIndex(settings.profile, [...io.files].map(([path, content]) => ({
      path,
      properties: parseProperties(splitNote(content).yaml, io.codec),
    })), io.paths(), {});
    const model = await loadItinerary(host, 'Travel/Trip.md');
    const layout = tripLayout(model, io.paths());
    return {
      model,
      layout,
      plan: tripDays(layout, model.trip),
      row: (name: string) => layout.entries.find(row => row.name === name)!,
    };
  }
  return {
    io,
    host,
    reload,
    ...(await reload()),
  };
}
