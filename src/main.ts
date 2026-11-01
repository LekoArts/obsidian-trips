import type { Modal } from 'obsidian';
import type { NoteType, PlannerSettings, Profile, RecognizedNote, Resolution } from './types';
import type { CreationOptions } from './ui/creation/modal';
import { debounce, Plugin } from 'obsidian';
import { noteName } from './config/paths';
import { emptySettings, tripContents } from './config/profile';
import { decodeSettings } from './config/storage';
import { filled } from './config/validation';
import { buildIndex } from './discovery';
import { attentionItems } from './discovery/attention';
import { capture } from './editing/conflicts';
import { ObsidianVault } from './io/vault';
import { notify } from './notice';
import { TravelSettingsTab } from './settings';
import { CreationModal } from './ui/creation/modal';
import { PropertyModal } from './ui/creation/property-modal';
import { TravelItineraryView, VIEW_TYPE_TRAVEL_ITINERARY } from './ui/itinerary/view';
import { pick } from './ui/suggest';

export default class TravelPlannerPlugin extends Plugin {
  settings: PlannerSettings = emptySettings();
  io = new ObsidianVault(this.app);
  index: RecognizedNote[] = [];
  authoringContext = { typeId: '', parentPath: '' };
  modals = new Set<Modal>();
  private listeners = new Set<(notes: RecognizedNote[]) => void>();
  private scheduleRefresh = debounce(() => this.rebuild(), 100, true);
  private loaded = false;

  async onload(): Promise<void> {
    try {
      this.settings = decodeSettings(await this.loadData());
    }
    catch (error) {
      notify(String(error), 0);
      return;
    }
    this.loaded = true;
    this.addSettingTab(new TravelSettingsTab(this.app, this));
    this.addCommand({
      id: 'create-trip',
      name: 'Create trip…',
      callback: () => { void this.createTrip(); },
    });
    this.addCommand({
      id: 'add-to-trip',
      name: 'Add to trip…',
      callback: () => { void this.addToTrip(); },
    });
    this.addCommand({
      id: 'edit-trip-properties',
      name: 'Edit trip properties…',
      callback: () => { void this.openProperties(); },
    });
    this.registerHoverLinkSource('trips', { display: 'Trips', defaultMod: true });
    this.registerView(VIEW_TYPE_TRAVEL_ITINERARY, leaf => new TravelItineraryView(leaf, this));
    this.addCommand({
      id: 'edit-trip-itinerary',
      name: 'Edit trip itinerary',
      callback: () => {
        const tripPath = this.currentTrip();
        // Saved view state also identifies background tabs that Obsidian has not loaded yet (deferred views).
        const open = filled(tripPath)
          ? this.app.workspace.getLeavesOfType(VIEW_TYPE_TRAVEL_ITINERARY).find(leaf => leaf.getViewState().state?.tripPath === tripPath)
          : undefined;
        if (open) {
          void this.app.workspace.revealLeaf(open);
          return;
        }
        void this.app.workspace.getLeaf('tab').setViewState({
          type: VIEW_TYPE_TRAVEL_ITINERARY,
          active: true,
          state: { tripPath: tripPath ?? '' },
        });
      },
    });
    this.addCommand({
      id: 'review-attention',
      name: 'Review notes that need attention',
      callback: () => { void this.reviewAttention(); },
    });
    const schedule = () => this.scheduleRefresh();
    this.registerEvent(this.app.vault.on('create', schedule));
    this.registerEvent(this.app.vault.on('modify', schedule));
    this.registerEvent(this.app.vault.on('delete', schedule));
    this.registerEvent(this.app.vault.on('rename', schedule));
    this.registerEvent(this.app.metadataCache.on('changed', schedule));
    this.registerEvent(this.app.metadataCache.on('resolved', schedule));
    this.app.workspace.onLayoutReady(() => {
      if (this.loaded)
        this.rebuild();
    });
  }

  /** The trip of the active note: the note itself when it is a trip, otherwise its parent. */
  private currentTrip(): string | undefined {
    this.rebuild();
    const current = this.index.find(note => note.path === this.app.workspace.getActiveFile()?.path);
    const type = this.settings.profile.types.find(type => type.id === current?.typeId);
    return type?.role === 'trip'
      ? current?.path
      : current?.parentPath;
  }

  private async contents(type: NoteType, ...texts: string[]): Promise<NoteType[]> {
    return tripContents(type, this.settings.profile.types, ...texts, this.io.exists(type.template)
      ? await this.io.read(type.template)
      : '');
  }

  private async createTrip(): Promise<void> {
    const kinds = this.settings.profile.types.filter(type => type.role === 'trip');
    if (!kinds.length) {
      notify('Add a trip kind in settings first');
      return;
    }
    const choices = await Promise.all(kinds.map(async (type) => {
      const contains = await this.contents(type);
      return {
        value: type.id,
        label: type.label,
        note: contains.length
          ? `with ${contains.map(kind => kind.label).join(', ')}`
          : undefined,
      };
    }));
    const typeId = kinds.length === 1
      ? kinds[0]?.id
      : await pick(this.app, choices, 'Which kind of trip?');
    if (filled(typeId))
      this.openCreation({ typeId });
  }

  /** Adds a day plan, stop or activity to the current trip, offering only the kinds that trip contains. */
  private async addToTrip(): Promise<void> {
    const types = new Map(this.settings.profile.types.map(type => [type.id, type]));
    const trips = this.index.filter(note => types.get(note.typeId ?? '')?.role === 'trip' && !note.diagnostics.some(d => d.capability === 'recognition'));
    let tripPath = this.currentTrip();
    if (!filled(tripPath)) {
      if (!trips.length) {
        notify('Create a trip first');
        return;
      }
      tripPath = await pick(this.app, trips.map(trip => ({
        value: trip.path,
        label: noteName(trip.path),
        note: trip.path,
      })), 'Add to which trip?');
      if (!filled(tripPath))
        return;
    }
    const trip = this.index.find(note => note.path === tripPath);
    const tripType = types.get(trip?.typeId ?? '');
    if (!trip || !tripType)
      return;
    const kinds = await this.contents(tripType, await this.io.read(trip.path));
    if (!kinds.length) {
      notify(`${tripType.label} trips are a single note; there is nothing to add to ${noteName(trip.path)}.`);
      return;
    }
    const typeId = kinds.length === 1
      ? kinds[0]?.id
      : await pick(this.app, kinds.map(kind => ({ value: kind.id, label: kind.label })), `Add to ${noteName(trip.path)}`);
    if (filled(typeId))
      this.openCreation({ typeId, parentPath: trip.path });
  }

  /** Notes the plugin can't fully read, newest trips first; picking one opens it and offers the choice that fixes it. */
  private async reviewAttention(): Promise<void> {
    this.rebuild();
    const types = new Map(this.settings.profile.types.map(type => [type.id, type]));
    const properties = new Map(this.io.snapshots().map(note => [note.path, note.properties]));
    const items = attentionItems(this.index, this.settings.profile.types, properties);
    if (!items.length) {
      notify('No travel notes need attention');
      return;
    }
    const path = await pick(this.app, items.map(item => ({ value: item.path, label: item.label, note: `${item.context} · ${item.problem}` })), 'Notes that need attention');
    const note = this.index.find(item => item.path === path);
    const file = filled(path)
      ? this.app.vault.getFileByPath(path)
      : null;
    if (!note || !file)
      return;
    await this.app.workspace.getLeaf(false).openFile(file);
    try {
      if (!filled(note.typeId) && note.candidates.length > 1) {
        const typeId = await pick(this.app, note.candidates.map(id => ({ value: id, label: types.get(id)?.label ?? id })), `Which kind is ${file.basename}?`);
        if (!filled(typeId))
          return;
        await this.choose(file.path, { typeId });
        notify(`${file.basename} is recognized as ${types.get(typeId)?.label ?? typeId}. The note was not changed.`);
      }
      else if (filled(note.typeId) && !filled(note.parentPath) && note.parentCandidates.length > 1) {
        const parentPath = await pick(this.app, note.parentCandidates.map(trip => ({
          value: trip,
          label: noteName(trip),
          note: trip,
        })), `Which trip is ${file.basename} part of?`);
        if (!filled(parentPath))
          return;
        await this.choose(file.path, { typeId: note.typeId, parentPath });
        notify(`${file.basename} is part of ${noteName(parentPath)}. The note was not changed.`);
      }
    }
    catch (error) { notify(String(error).replace(/^Error:\s*/, ''), 0); }
  }

  openCreation(options: CreationOptions): void { new CreationModal(this, options).open(); }
  async rememberCreated(notes: { path: string; typeId: string }[]): Promise<void> {
    const resolutions = { ...this.settings.resolutions };
    for (const note of notes) resolutions[note.path] = { typeId: note.typeId };
    const next = { ...this.settings, resolutions };
    await this.saveData(next);
    this.settings = next;
    this.rebuild();
  }

  private async openProperties(): Promise<void> {
    try {
      this.rebuild();
      const path = this.app.workspace.getActiveFile()?.path;
      const note = this.index.find(note => note.path === path);
      const type = this.settings.profile.types.find(type => type.id === note?.typeId);
      if (!filled(path) || !type || note?.diagnostics.some(d => d.capability === 'recognition'))
        throw new Error('Open a recognized travel note and resolve its type in settings first');
      await new PropertyModal(this, await capture(this.io, path), structuredClone(type)).show();
    }
    catch (error) { notify(String(error), 0); }
  }

  rebuild(): void {
    this.index = buildIndex(this.settings.profile, this.io.snapshots(), this.io.paths(), this.settings.resolutions);
    for (const listener of this.listeners) listener(this.index);
  }

  subscribe(listener: (notes: RecognizedNote[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.index);
    return () => this.listeners.delete(listener);
  }

  async saveProfile(profile: Profile): Promise<void> {
    // Keep recognition choices: the index ignores any that no longer match a candidate.
    const next: PlannerSettings = { ...this.settings, profile };
    await this.saveData(next);
    this.settings = next;
    this.rebuild();
  }

  async choose(path: string, resolution: Resolution): Promise<void> {
    const note = this.index.find(note => note.path === path);
    if (!note?.candidates.includes(resolution.typeId) || (filled(resolution.parentPath) && !note.parentCandidates.includes(resolution.parentPath)))
      throw new Error('Recognition candidates changed; refresh and choose again');
    const next = {
      ...this.settings,
      resolutions: { ...this.settings.resolutions, [path]: resolution },
    };
    await this.saveData(next);
    this.settings = next;
    this.rebuild();
  }

  onunload(): void {
    this.loaded = false;
    this.scheduleRefresh.cancel();
    for (const modal of this.modals) modal.close();
    this.modals.clear();
    this.listeners.clear();
    this.index = [];
  }
}
