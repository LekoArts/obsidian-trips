import type { App } from 'obsidian';
import type { CreationDraft, CreationReport, ParentNote } from '../../creation/create';
import type { ObsidianVault } from '../../io/vault';
import type { NoteType, PlannerSettings, RecognizedNote } from '../../types';
import { Modal } from 'obsidian';
import { mount, unmount } from 'svelte';
import { noteName } from '../../config/paths';
import { filled, validDate } from '../../config/validation';
import { applyCreation, previewCreation } from '../../creation/create';
import { capture } from '../../editing/conflicts';
import { labelDialog } from '../dialog';
import { pick } from '../suggest';
import CreationForm from './CreationForm.svelte';
import { parseFields } from './fields';

export interface TripChoice { path: string; name: string; start?: string; end?: string }
export interface ActivityChoice { link: string; label: string }
export interface FormDraft { name: string; start: string; end: string; fields: Record<string, string>; activities: { link: string; day?: string }[] }
export interface AuthoringHost {
  app: App;
  io: ObsidianVault;
  settings: PlannerSettings;
  index: RecognizedNote[];
  authoringContext: { typeId: string; parentPath: string };
  modals: Set<Modal>;
  rememberCreated: (notes: { path: string; typeId: string }[]) => Promise<void>;
  rebuild: () => void;
}
export interface CreationOptions {
  /** The kind being created, always chosen before the form opens. */
  typeId: string;
  /** The trip a new entry or activity belongs to. */
  parentPath?: string;
  initial?: { name?: string; start?: string; end?: string };
  /** Where the new note opens: beside the trip tab when started there. */
  openIn?: 'tab' | 'split';
  onCreated?: (paths: string[]) => void;
}

export class CreationModal extends Modal {
  private component: ReturnType<typeof mount> | undefined;
  private profile: PlannerSettings['profile'];
  constructor(private host: AuthoringHost, private options: CreationOptions) {
    super(host.app);
    this.profile = structuredClone(host.settings.profile);
  }

  private type(id: string): NoteType {
    const type = this.profile.types.find(item => item.id === id);
    if (!type)
      throw new Error('Configure this kind in settings first');
    return type;
  }

  private checkProfile(): void {
    if (JSON.stringify(this.profile) !== JSON.stringify(this.host.settings.profile))
      throw new Error('Settings changed; close this form and open it again');
  }

  private async parent(path: string): Promise<ParentNote> {
    const note = this.host.index.find(note => note.path === path);
    if (!filled(note?.typeId) || note.diagnostics.some(d => d.capability === 'recognition'))
      throw new Error('The trip needs attention first; run "Review notes that need attention"');
    const type = this.type(note.typeId);
    if (type.role !== 'trip')
      throw new Error('Choose a trip');
    return {
      ...await capture(this.host.io, path),
      type,
    };
  }

  /** The shortest link that still points at the file, as Obsidian itself would write it. */
  private linkText(path: string, from: string): string {
    const file = this.app.vault.getFileByPath(path);
    return file
      ? this.app.metadataCache.fileToLinktext(file, from, true)
      : path;
  }

  private tripChoice(path: string): TripChoice | undefined {
    const note = this.host.index.find(item => item.path === path);
    const type = this.profile.types.find(item => item.id === note?.typeId);
    const snapshot = this.host.io.snapshots().find(item => item.path === path);
    if (!note || !type || !snapshot)
      return undefined;
    const properties = snapshot.properties;
    const date = (value: unknown) => validDate(value)
      ? value
      : undefined;
    return {
      path,
      name: noteName(path),
      start: date(properties[type.mappings.start]),
      end: date(properties[type.mappings.end]),
    };
  }

  private async create(form: FormDraft): Promise<CreationReport> {
    this.checkProfile();
    this.host.rebuild();
    const type = this.type(this.options.typeId);
    const parent = type.role === 'trip'
      ? undefined
      : await this.parent(this.options.parentPath ?? '');
    const draft: CreationDraft = {
      type,
      name: form.name,
      start: form.start || undefined,
      end: form.end || undefined,
      fields: parseFields(type.fields, form.fields),
      parent,
      parentLink: parent && this.linkText(parent.path, parent.path),
      activities: form.activities,
    };
    const plan = await previewCreation(this.host.io, [draft]);
    this.checkProfile();
    const report = await applyCreation(this.host.io, plan);
    this.host.authoringContext = { typeId: type.id, parentPath: this.options.parentPath ?? '' };
    try {
      await this.host.rememberCreated(report.completed.map(path => ({ path, typeId: type.id })));
    }
    catch (error) { report.error = `${report.error ?? ''} The note was written, but remembering its kind failed: ${String(error)}`; }
    return report;
  }

  onOpen(): void {
    const type = this.type(this.options.typeId);
    this.host.modals.add(this);
    this.host.rebuild();
    const trip = type.role === 'trip'
      ? undefined
      : this.tripChoice(this.options.parentPath ?? '');
    labelDialog(this, type.role === 'trip'
      ? `New ${type.label.toLowerCase().endsWith('trip')
        ? type.label
        : `${type.label} trip`}`
      : `New ${type.label}`);
    const activities: ActivityChoice[] = trip
      ? this.host.index
          .filter(note => note.parentPath === trip.path && this.profile.types.find(item => item.id === note.typeId)?.role === 'activity')
          .map(note => ({
            link: this.linkText(note.path, trip.path),
            label: noteName(note.path),
          }))
          .sort((a, b) => a.label.localeCompare(b.label))
      : [];
    this.component = mount(CreationForm, {
      target: this.contentEl,
      props: {
        type,
        trip,
        initial: this.options.initial,
        activities,
        pickActivity: async (choices: ActivityChoice[]) => {
          const link = await pick(this.app, choices.map(item => ({ value: item.link, label: item.label })), 'Add an activity');
          return choices.find(item => item.link === link);
        },
        exists: (path: string) => !!this.app.vault.getAbstractFileByPath(path),
        create: async (form: FormDraft) => this.create(form),
        close: () => this.close(),
        created: (report: CreationReport) => {
          this.close();
          const first = report.completed[0];
          // Obsidian opens a note you just created; the trip tab keeps its place when the note opens beside it.
          if (filled(first) && !filled(report.failed))
            void this.app.workspace.openLinkText(first, '', this.options.openIn ?? false);
          this.options.onCreated?.(report.completed);
        },
      },
    });
  }

  onClose(): void {
    if (this.component)
      void unmount(this.component);
    this.component = undefined;
    this.host.modals.delete(this);
    this.contentEl.empty();
  }
}
