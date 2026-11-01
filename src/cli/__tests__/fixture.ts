import type { PlannerSettings } from '../../types';
import type { CliContext } from '../commands';
import { noteName } from '../../config/paths';
import { emptySettings, presetProfile } from '../../config/profile';
import { parseProperties, splitNote } from '../../config/template-render';
import { buildIndex } from '../../discovery';
import { TestVault } from '../../editing/test-vault';

export const TRIP = 'Travel/2026/Lisbon/Lisbon.md';
export const tripNote = (start = '2026-09-10', end = '2026-09-13') => `---\n{"base":"[[_templates/Bases/Travel.base]]","startDate":"${start}","endDate":"${end}"}\n---\n![[_templates/Bases/Planning.base]]\n`;
export const activityNote = (trip = 'Lisbon') => `---\n{"base":"[[_templates/Bases/Activities.base]]","backlink":"[[${trip}]]"}\n---\nActivity\n`;

/**
 * A vault with the travel preset's templates and Bases, and a CLI context over it. Trips share one recognition value in
 * the preset, so `trips` are remembered as Advanced the way creating them would; other notes are recognized as written.
 */
export function cliVault(files: Record<string, string> = {}, trips: string[] = []) {
  const io = Object.assign(new TestVault(), {
    paths: () => [
      ...io.files.keys(),
    ],
  });
  const templates: Record<string, string> = {
    '_templates/Travel_Simple.md': '# Simple\n',
    '_templates/Travel_Advanced.md': '![[_templates/Bases/Planning.base]]\n',
    '_templates/Travel_Roadtrip.md': '![[_templates/Bases/Roadtrip.base]]\n',
    '_templates/Planning.md': 'Plan\n',
    '_templates/Stop.md': 'Stop\n',
    '_templates/Activity.md': 'Activity\n',
  };
  for (const [path, content] of Object.entries(templates)) io.files.set(path, content);
  for (const base of [
    'Travel',
    'Planning',
    'Roadtrip',
    'Activities',
  ]) io.files.set(`_templates/Bases/${base}.base`, 'views: []');
  for (const [path, content] of Object.entries(files)) io.files.set(path, content);
  const state: { settings: PlannerSettings; hidden: Set<string>; refreshes: number } = {
    settings: {
      ...emptySettings(),
      profile: presetProfile(),
      resolutions: Object.fromEntries(trips.map(path => [
        path,
        { typeId: 'advanced' },
      ])),
    },
    // Notes the metadata cache hasn't read yet: left out of the index until the next refresh.
    hidden: new Set(),
    refreshes: 0,
  };
  const snapshots = () => [...io.files].filter(([path]) => path.endsWith('.md')).map(([path, content]) => ({
    path,
    properties: parseProperties(splitNote(content).yaml, io.codec),
  }));
  let index = buildIndex(state.settings.profile, snapshots(), io.paths(), state.settings.resolutions);
  const ctx: CliContext = {
    io,
    settings: () => state.settings,
    index: () => index.filter(note => !state.hidden.has(note.path)),
    properties: () => new Map(snapshots().map(note => [note.path, note.properties])),
    templates: new Map(Object.entries(templates)),
    linkText: path => noteName(path),
    rememberCreated: async (notes) => {
      const resolutions = { ...state.settings.resolutions };
      for (const note of notes) resolutions[note.path] = { typeId: note.typeId };
      state.settings = { ...state.settings, resolutions };
      ctx.refresh();
      return Promise.resolve();
    },
    refresh: () => {
      state.refreshes++;
      state.hidden.clear();
      index = buildIndex(state.settings.profile, snapshots(), io.paths(), state.settings.resolutions);
    },
    wait: async () => Promise.resolve(),
  };
  return { io, ctx, state };
}
