import type { ParentNote } from '../../creation/create';
import type { FileSnapshot } from '../../editing/conflicts';
import type { FieldDefinition, NoteType } from '../../types';
import type { AuthoringHost } from './modal';
import { Modal } from 'obsidian';
import { mount, unmount } from 'svelte';
import { noteName } from '../../config/paths';
import { parseProperties, splitNote } from '../../config/template-render';
import { filled, validDate } from '../../config/validation';
import { capture } from '../../editing/conflicts';
import { editProperties } from '../../editing/properties';
import { labelDialog } from '../dialog';
import PropertyForm from './PropertyForm.svelte';

export class PropertyModal extends Modal {
  private component: ReturnType<typeof mount> | undefined;
  private parent?: ParentNote;
  private profile: string;
  constructor(private host: AuthoringHost, private snapshot: FileSnapshot, private type: NoteType) {
    super(host.app);
    this.profile = JSON.stringify(host.settings.profile);
  }

  private async refresh(): Promise<{ snapshot: FileSnapshot; properties: Record<string, unknown> }> {
    if (JSON.stringify(this.host.settings.profile) !== this.profile)
      throw new Error('Configuration changed; reopen the form');
    this.host.rebuild();
    const recognized = this.host.index.find(note => note.path === this.snapshot.path);
    if (recognized?.typeId !== this.type.id || recognized.diagnostics.some(d => d.capability === 'recognition'))
      throw new Error('Recognition changed; resolve this note in settings');
    this.snapshot = await capture(this.host.io, this.snapshot.path);
    this.parent = undefined;
    if (filled(recognized.parentPath)) {
      const parent = this.host.index.find(note => note.path === recognized.parentPath);
      const parentType = this.host.settings.profile.types.find(type => type.id === parent?.typeId);
      if (parentType?.role === 'trip') {
        this.parent = {
          ...await capture(this.host.io, recognized.parentPath),
          type: parentType,
        };
      }
    }
    return {
      snapshot: this.snapshot,
      properties: parseProperties(splitNote(this.snapshot.content).yaml, this.host.io.codec),
    };
  }

  async show(): Promise<void> {
    const result = await this.refresh();
    labelDialog(this, `Properties of ${noteName(this.snapshot.path)}`);
    this.open();
    this.host.modals.add(this);
    const dates: FieldDefinition[] = [
      [this.type.mappings.start, 'Start date'],
      [this.type.mappings.end, 'End date'],
    ]
      .filter((pair): pair is [string, string] => Boolean(pair[0]))
      .map(([key, label]) => ({
        key,
        label,
        type: 'date',
        required: false,
      }));
    const fields: FieldDefinition[] = [
      ...dates,
      ...this.type.fields,
    ];
    const { start, end } = this.type.mappings;
    const tripProperties = this.parent
      ? parseProperties(splitNote(this.parent.content).yaml, this.host.io.codec)
      : {};
    const tripDate = (key: string) => this.parent && validDate(tripProperties[key])
      ? tripProperties[key]
      : undefined;
    const range = this.type.dated && start && end
      ? {
          start,
          end,
          min: tripDate(this.parent?.type.mappings.start ?? ''),
          max: tripDate(this.parent?.type.mappings.end ?? ''),
        }
      : undefined;
    this.component = mount(PropertyForm, {
      target: this.contentEl,
      props: {
        initial: result.snapshot,
        initialProperties: result.properties,
        fields,
        dates: range,
        save: async (expected: FileSnapshot, changes: Record<string, unknown>) => {
          if (JSON.stringify(this.host.settings.profile) !== this.profile)
            throw new Error('Configuration changed; reopen the form');
          this.host.rebuild();
          const note = this.host.index.find(note => note.path === expected.path);
          if (note?.typeId !== this.type.id || note.diagnostics.some(d => d.capability === 'recognition'))
            throw new Error('Recognition changed; resolve this note in settings');
          await editProperties(this.host.io, expected, this.type, changes, this.parent);
        },
        refresh: async () => this.refresh(),
        close: () => this.close(),
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
