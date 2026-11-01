import type { App, ExtraButtonComponent, Plugin, SettingDefinition, SettingDefinitionItem, SettingDefinitionPage } from 'obsidian';
import type { InstallPreview } from './config/preset-install';
import type { SharedKey } from './config/shared-properties';
import type { ObsidianVault } from './io/vault';
import type { FieldDefinition, NoteType, PlannerSettings, Profile } from './types';
import { Modal, moment, normalizePath, PluginSettingTab } from 'obsidian';
import { mount, unmount } from 'svelte';
import { dateProperties, starterTemplate, suggestFields } from './config/field-suggestions';
import { noteName, resolvePath } from './config/paths';
import { installPreview, previewInstall, validateTemplateLinks } from './config/preset-install';
import { emptySettings, newType, presetProfile, tripContents, validateProfile } from './config/profile';
import { recogniseByBase, recognisedByBase } from './config/recognition';
import { appliesTo, differsFromShared, propertyOf, setProperty, sharedFollowers, sharedValue } from './config/shared-properties';
import { filled } from './config/validation';
import { resolveTargets } from './discovery';
import { notify } from './notice';
import { formatDate } from './travel/dates';
import { confirmAction } from './ui/confirm';
import { labelDialog } from './ui/dialog';
import { editField } from './ui/field-modal';
import InstallPreviewComponent from './ui/InstallPreview.svelte';
import { pick } from './ui/suggest';

export interface SettingsHost extends Plugin {
  settings: PlannerSettings;
  io: ObsidianVault;
  saveProfile: (profile: Profile) => Promise<void>;
}

class PresetModal extends Modal {
  private component: ReturnType<typeof mount> | undefined;
  private result: Profile | undefined;
  constructor(app: App, private host: SettingsHost, private preview: InstallPreview[], private done: (profile: Profile | undefined) => void) { super(app); }
  onOpen(): void {
    labelDialog(this, 'Use the travel setup');
    this.component = mount(InstallPreviewComponent, {
      target: this.contentEl,
      props: {
        preview: this.preview,
        profile: presetProfile(),
        cancel: () => this.close(),
        confirm: async () => {
          const report = await installPreview(this.host.io, this.preview);
          if (filled(report.failed))
            throw new Error(`Installation stopped. Completed: ${report.completed.join(', ') || 'none'}. Failed: ${report.failed}. Untouched: ${report.untouched.join(', ')}. Review files before retrying; nothing was rolled back.`);
          this.result = presetProfile();
          if (this.host.io.exists('Travel.base')) {
            for (const type of this.result.types.filter(type => type.role === 'trip')) {
              type.basePath = 'Travel.base';
              type.recognition.value = '[[Travel.base]]';
            }
          }
          this.close();
        },
      },
    });
  }

  onClose(): void {
    if (this.component)
      void unmount(this.component);
    this.component = undefined;
    this.contentEl.empty();
    this.done(this.result);
  }
}

/** Every problem with a profile, including its template and Base files; `read` supplies template text. */
export async function profileProblems(profile: Profile, io: ObsidianVault, read: (path: string) => Promise<string> = async path => io.read(path)): Promise<string[]> {
  const templates = new Map<string, string>();
  const errors: string[] = [];
  const paths = io.paths();
  for (const type of profile.types) {
    if (type.template && io.exists(type.template)) {
      const body = await read(type.template);
      templates.set(type.template, body);
      // Parent placeholders in reused legacy templates are filled on creation, not setup.
      const links = validateTemplateLinks(body, (target) => {
        if (target === 'TODO')
          return target;
        const found = resolveTargets(target, paths);
        return found.length === 1
          ? found[0]
          : undefined;
      });
      errors.push(...links.map(message => `${type.id}: ${message}`));
    }
  }
  errors.push(...validateProfile(profile, {
    exists: path => io.exists(path),
    template: path => templates.get(path),
  }).map(d => d.path
    ? `${d.path}: ${d.message}`
    : d.message));
  return errors;
}

type Bind = (profile: Profile, value: unknown) => void;
interface Binding { get: () => unknown; set: Bind }

const sharedNames: { key: SharedKey; label: string; description: string }[] = [
  { key: 'start', label: 'Start date', description: 'Holds the first day of a trip, day plan or stop.' },
  { key: 'end', label: 'End date', description: 'Holds the last day.' },
  { key: 'parent', label: 'Link to the trip', description: 'Links day plans, stops and activities to their trip.' },
  { key: 'activities', label: 'Activity list', description: 'Lists the activities of a trip or day plan.' },
  { key: 'base', label: 'Base link', description: 'Links a note to the Base it appears in; also used to recognise it.' },
];
const ownNames: { key: Exclude<SharedKey, 'base'>; label: string; description: string }[] = [
  { key: 'start', label: 'Start date property', description: '' },
  { key: 'end', label: 'End date property', description: '' },
  { key: 'parent', label: 'Link to the trip property', description: 'Links each note to its trip.' },
  { key: 'activities', label: 'Activity list property', description: 'Lists the activities that belong to this note.' },
];
const typeNames: Record<FieldDefinition['type'], string> = {
  'text': 'Text',
  'number': 'Number',
  'boolean': 'Yes / no',
  'date': 'Date',
  'url': 'Web address',
  'text-list': 'List',
  'note-link': 'Link',
  'note-link-list': 'Links',
};

const slug = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'kind';
const code = (text: string) => createFragment(fragment => fragment.createEl('code', { text }));
/** A description with `code` spans: strings stay text, one-element arrays become code. */
function rich(...parts: (string | [string])[]): DocumentFragment {
  return createFragment((fragment) => {
    for (const part of parts) {
      fragment.append(typeof part === 'string'
        ? part
        : code(part[0]));
    }
  });
}
function defaultText(field: FieldDefinition): string {
  const value = field.defaultValue;
  if (value === undefined || value === '' || (Array.isArray(value) && !value.length))
    return '';
  if (field.type === 'boolean') {
    return ` · starts as ${value === true
      ? 'yes'
      : 'no'}`;
  }
  return ` · starts as ${Array.isArray(value)
    ? value.join(', ')
    : typeof value === 'string' || typeof value === 'number'
      ? `${value}`
      : JSON.stringify(value)}`;
}

/**
 * Settings are Obsidian's own declarative settings, so they render natively and show up in settings search. Each
 * change is checked against the whole setup (templates and Bases included) before it is saved; a change that would
 * make the setup invalid is refused inline and the last valid setup stays active.
 */
/** Like core Daily notes: a link to the format reference and today's date in the current format. */
function dayFormatHelp(format: string): DocumentFragment {
  return createFragment((el) => {
    el.appendText('Also used to find daily activities in existing notes. ');
    el.createEl('a', { text: 'Format reference', href: 'https://momentjs.com/docs/#/displaying/format/' });
    el.createEl('br');
    // Obsidian types `moment` as a namespace, which TypeScript 6 won't call; `utc()` then `local()` is today.
    el.appendText(`Today's heading: ${formatDate(moment.utc().local().format('YYYY-MM-DD'), format)}`);
  });
}

export class TravelSettingsTab extends PluginSettingTab {
  private bindings = new Map<string, Binding>();
  private templates = new Map<string, string>();
  /** Problems the saved setup already has, so they show on its kinds and don't block unrelated changes. */
  private problems: string[] | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private followers: { key: SharedKey; ids: string[] } | undefined;
  private modal: Modal | undefined;
  constructor(app: App, private host: SettingsHost) {
    super(app, host);
  }

  private get profile(): Profile {
    return this.host.settings.profile;
  }

  /** Reads a template from disk; the copy kept in `templates` is only for summaries shown while drawing. */
  private async read(path: string): Promise<string> {
    const text = await this.host.io.read(path);
    this.templates.set(path, text);
    return text;
  }

  private async current(): Promise<string[]> {
    this.problems ??= await profileProblems(this.profile, this.host.io, async path => this.read(path));
    return this.problems;
  }

  /** Problems a candidate adds to the current setup. */
  private async added(candidate: Profile): Promise<string[]> {
    const before = await this.current();
    const after = await profileProblems(candidate, this.host.io, async path => this.read(path));
    return after.filter(problem => !before.includes(problem));
  }

  /** Runs changes one at a time, each on the profile the previous one saved. */
  private async serial(task: () => Promise<void>): Promise<void> {
    const previous = this.queue;
    const next = (async () => {
      await previous;
      await task();
    })();
    this.queue = next.catch(() => undefined);
    return next;
  }

  private readable(problem: string): string {
    const kind = this.profile.types.find(type => problem.startsWith(`${type.id}: `));
    return kind
      ? problem.slice(kind.id.length + 2)
      : problem;
  }

  private async save(candidate: Profile): Promise<boolean> {
    const added = await this.added(candidate);
    if (added.length) {
      notify(`Not saved: ${this.readable(added[0] ?? '')}`);
      return false;
    }
    await this.host.saveProfile(candidate);
    this.problems = await profileProblems(candidate, this.host.io, async path => this.read(path));
    return true;
  }

  /** Applies a structural change (adding or removing kinds, fields, the whole setup) and redraws. */
  private async commit(change: (profile: Profile) => void): Promise<void> {
    return this.serial(async () => {
      const candidate = structuredClone(this.profile);
      change(candidate);
      if (await this.save(candidate))
        this.update();
    });
  }

  getControlValue(key: string): unknown {
    return this.bindings.get(key)?.get();
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const binding = this.bindings.get(key);
    if (!binding)
      return;
    if (this.followers && !key.startsWith(`shared.${this.followers.key}`))
      this.followers = undefined;
    await this.commit(candidate => binding.set(candidate, value));
  }

  private async validate(key: string, value: unknown): Promise<string | undefined> {
    const binding = this.bindings.get(key);
    if (!binding)
      return undefined;
    const candidate = structuredClone(this.profile);
    binding.set(candidate, value);
    const added = await this.added(candidate);
    return added.length
      ? this.readable(added[0] ?? '')
      : undefined;
  }

  /** Registers a value with its reader and writer, and returns the control's key and validator. */
  private bind<V>(key: string, get: () => V, set: (profile: Profile, value: V) => void): { key: string; validate: (value: V) => Promise<string | undefined> } {
    this.bindings.set(key, { get, set: set as Bind });
    return {
      key,
      validate: async value => this.validate(key, value),
    };
  }

  /** Edits kind `index`; `set` receives that kind in the candidate profile. */
  private bindKind<V>(index: number, name: string, get: (type: NoteType) => V, set: (type: NoteType, value: V, profile: Profile) => void) {
    return this.bind<V>(`kind.${index}.${name}`, () => get(this.profile.types[index]!), (profile, value) => {
      const type = profile.types[index];
      if (type)
        set(type, value, profile);
    });
  }

  /** Records the problems the saved profile already has, so only new ones are reported against an edit. */
  private async loadProblems(): Promise<void> {
    try {
      await this.current();
    }
    catch {
      this.problems = [];
      return;
    }
    this.update();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    this.bindings.clear();
    if (this.problems === undefined)
      void this.loadProblems();
    return this.profile.types.length
      ? this.configured()
      : this.firstRun();
  }

  hide(): void {
    this.modal?.close();
    this.modal = undefined;
    this.followers = undefined;
    this.problems = undefined;
    this.templates.clear();
    super.hide();
  }

  private firstRun(): SettingDefinitionItem[] {
    return [
      {
        name: 'Trips',
        desc: 'Trips creates your trip notes from templates and keeps their dates, day plans and activities consistent. Everything stays ordinary notes you can read and edit without the plugin. Choose how to start; you can change it later.',
        searchable: false,
      },
      {
        type: 'group',
        items: [
          {
            name: 'Use the travel setup',
            desc: 'Adds ready-made templates for simple trips, trips with day plans and activities, and road trips, plus the Bases that list them. You see the list first; files already in your vault are never changed.',
            action: () => void this.usePreset(),
          },
          {
            name: 'Use my own templates',
            desc: rich('Pick a note to use as the template for your trips, or let Trips create a starter one. Its start and end dates come from the properties holding ', ['{{start_date}}'], ' and ', ['{{end_date}}'], ', for example ', ['startDate: "{{start_date}}"'], '. Its other properties become fields you fill in when creating a trip.'),
            action: () => void this.useOwn(),
          },
        ],
      },
    ];
  }

  private configured(): SettingDefinitionItem[] {
    const profile = this.profile;
    const folder = profile.scopes[0] ?? '';
    const templateFolder = this.templateFolder();
    const kinds = profile.types.map((type, index) => ({ type, index }));
    return [
      {
        name: 'Using Trips',
        desc: rich('Run ', ['Trips: Create trip'], ' from the command palette (Cmd/Ctrl+P). With a trip note open, ', ['Trips: Edit trip itinerary'], ' plans its days and ', ['Trips: Add to trip'], ' adds day plans and activities.'),
        searchable: false,
      },
      {
        type: 'group',
        items: [
          {
            name: 'Travel folder',
            desc: rich('New trips are saved in ', [`${folder}/`], ', and trips are found there.', profile.scopes.length > 1
              ? ` Also read: ${profile.scopes.slice(1).join(', ')}.`
              : ''),
            aliases: ['scope', 'location'],
            action: () => void this.changeFolder(),
          },
          {
            name: 'Templates',
            desc: rich('Ordinary notes in ', [`${templateFolder ?? ''}/`], '. Edit headings, callouts and text freely. Keep the properties listed under Property names and the ', ['{{…}}'], ' placeholders: that\'s how trips are recognised and filled in.'),
            visible: templateFolder !== undefined,
            action: () => void this.revealFolder(templateFolder ?? ''),
          },
        ],
      },
      {
        type: 'list',
        heading: 'Trip kinds',
        items: kinds.filter(({ type }) => type.role === 'trip').map(({ type, index }) => this.kindPage(type, index)),
        emptyState: 'No trip kinds.',
        addItem: {
          name: 'Add trip kind',
          action: () => void this.addKind(true),
        },
        onDelete: index => void this.removeKind(kinds.filter(({ type }) => type.role === 'trip')[index]?.index),
      },
      {
        type: 'list',
        heading: 'Inside a trip',
        items: kinds.filter(({ type }) => type.role !== 'trip').map(({ type, index }) => this.kindPage(type, index)),
        emptyState: 'Nothing yet: trips are single notes.',
        addItem: {
          name: 'Add note kind',
          action: () => void this.addKind(false),
        },
        onDelete: index => void this.removeKind(kinds.filter(({ type }) => type.role !== 'trip')[index]?.index),
      },
      {
        type: 'group',
        heading: 'Property names',
        items: [
          {
            name: 'Renaming a property here doesn\'t rename it in existing notes.',
            searchable: false,
          },
          ...sharedNames.filter(name => profile.types.some(type => appliesTo(type, name.key))).map(name => this.sharedName(name)),
        ],
      },
      {
        type: 'group',
        items: [
          {
            name: 'Forget this setup',
            desc: 'Your notes, templates and Bases stay. You choose a setup again afterwards.',
            aliases: ['start over', 'reset'],
            action: () => void this.startOver(),
          },
        ],
      },
    ];
  }

  private sharedName(name: (typeof sharedNames)[number]): SettingDefinition {
    const own = this.profile.types.filter(type => differsFromShared(type, this.profile.types, name.key));
    const desc = own.length
      ? `${name.description} ${own.map(type => `${type.label} uses “${propertyOf(type, name.key)}”`).join('. ')}.`
      : name.description;
    // The kinds a rename applies to are fixed at its first keystroke, so typing can't pull in a kind with its own name.
    const followers = (profile: Profile) => {
      if (this.followers?.key !== name.key) {
        this.followers = {
          key: name.key,
          ids: sharedFollowers(profile.types, name.key).map(type => type.id),
        };
      }
      return this.followers.ids;
    };
    return {
      name: name.label,
      desc,
      control: {
        type: 'text',
        ...this.bind<string>(`shared.${name.key}`, () => {
          const first = this.profile.types.find(type => type.id === this.followers?.ids[0]);
          return this.followers?.key === name.key && first
            ? propertyOf(first, name.key)
            : sharedValue(this.profile.types, name.key);
        }, (profile, value) => {
          const ids = followers(profile);
          for (const type of profile.types.filter(type => ids.includes(type.id))) setProperty(type, name.key, value);
        }),
      },
    };
  }

  private kindPage(type: NoteType, index: number): SettingDefinitionPage {
    const problems = (this.problems ?? []).filter(problem => problem.startsWith(`${type.id}: `)).map(problem => this.readable(problem));
    return {
      type: 'page',
      name: type.label || 'Unnamed kind',
      desc: problems[0] ?? this.kindSummary(type),
      status: problems.length ? 'warning' : null,
      items: [
        ...this.kindBasics(type, index),
        ...(type.role === 'trip'
          ? [
              this.kindContains(index),
            ]
          : []),
        this.kindFields(type, index),
        this.kindRecognition(type, index),
      ],
    };
  }

  private kindSummary(type: NoteType): string {
    if (type.role === 'activity')
      return 'Placed on days';
    if (type.role === 'entry')
      return type.days.enabled ? 'Dated entry · one section per day' : 'Dated entry';
    const ids = this.contains(type);
    if (ids.length)
      return `With ${ids.map(id => this.profile.types.find(kind => kind.id === id)?.label ?? id).join(', ')}`;
    return 'Single note';
  }

  /** The kinds a trip kind holds: its explicit list, or what its template's Bases suggest. */
  private contains(type: NoteType): string[] {
    return tripContents(type, this.profile.types, this.templates.get(type.template) ?? '').map(kind => kind.id);
  }

  private kindBasics(type: NoteType, index: number): SettingDefinitionItem[] {
    let example: string;
    try {
      example = resolvePath(type.pathPattern, {
        tripName: 'Lisbon',
        entryName: 'Alfama',
        tripStart: '2026-09-10',
        isTrip: type.role === 'trip',
      });
    }
    catch (error) { example = String(error).replace(/^Error:\s*/, ''); }
    return [
      {
        name: 'Name',
        desc: 'How this kind appears in menus and buttons.',
        control: {
          type: 'text',
          ...this.bindKind<string>(index, 'label', kind => kind.label, (kind, value) => { kind.label = value; }),
        },
      },
      {
        name: 'Kind',
        desc: type.role === 'activity'
          ? 'Collected for a trip and placed on its days.'
          : 'Has its own start and end dates, like a day plan or a stop.',
        visible: type.role !== 'trip',
        control: {
          type: 'dropdown',
          options: { entry: 'Dated entry', activity: 'Activity' },
          ...this.bindKind<string>(index, 'role', kind => kind.role, (kind, value) => {
            kind.role = value === 'activity'
              ? 'activity'
              : 'entry';
            kind.dated = kind.role !== 'activity';
            if (kind.role === 'activity')
              kind.days.enabled = false;
          }),
        },
      },
      {
        name: 'Template',
        desc: type.template ? 'New notes start as a copy of this note.' : 'None. New notes get the minimal body below.',
        control: {
          type: 'file',
          placeholder: 'No template',
          filter: file => file.extension === 'md',
          ...this.bindKind<string>(index, 'template', kind => kind.template, (kind, value) => { kind.template = value; }),
        },
      },
      {
        name: 'Minimal body',
        desc: 'Used when no template is set.',
        visible: !type.template,
        control: {
          type: 'textarea',
          ...this.bindKind<string>(index, 'minimalBody', kind => kind.minimalBody, (kind, value) => { kind.minimalBody = value; }),
        },
      },
      {
        name: 'Save new notes to',
        desc: rich('Use ', ['{{trip_name}}'], ', ', ['{{entry_name}}'], ' and ', ['{{trip_start_year}}'], '. Example: ', [example]),
        control: {
          type: 'text',
          ...this.bindKind<string>(index, 'pathPattern', kind => kind.pathPattern, (kind, value) => { kind.pathPattern = value; }),
        },
      },
      {
        name: 'One section per day',
        desc: 'New notes get a heading for each of their dates, with room for that day\'s activities.',
        visible: type.role === 'entry',
        control: {
          type: 'toggle',
          ...this.bindKind<boolean>(index, 'days', kind => kind.days.enabled, (kind, value) => { kind.days.enabled = value; }),
        },
      },
    ];
  }

  private kindContains(index: number): SettingDefinitionItem {
    const inside = this.profile.types.filter(kind => kind.role !== 'trip');
    return {
      type: 'group',
      heading: 'Contains',
      items: [
        { name: 'What you can add to trips of this kind. With nothing on, a trip is a single note.', searchable: false },
        ...inside.map((kind): SettingDefinition => ({
          name: kind.label,
          control: {
            type: 'toggle',
            ...this.bindKind<boolean>(index, `contains.${kind.id}`, trip => (trip.contains ?? this.contains(trip)).includes(kind.id), (trip, on) => {
              const current = trip.contains ?? this.contains(trip);
              trip.contains = on
                ? [
                    ...new Set([...current, kind.id]),
                  ]
                : current.filter(id => id !== kind.id);
            }),
          },
        })),
        { name: 'Add a kind under Inside a trip first.', visible: !inside.length, searchable: false },
      ],
    };
  }

  private kindFields(type: NoteType, index: number): SettingDefinitionItem {
    const edit = async (at?: number) => {
      const field = at === undefined
        ? {
            key: '',
            label: '',
            type: 'text' as const,
            required: false,
          }
        : type.fields[at];
      if (!field)
        return;
      const result = await editField(this.app, field, at === undefined
        ? 'Add property'
        : `Edit ${field.label || field.key}`);
      if (result) {
        await this.commit((profile) => {
          const fields = profile.types[index]?.fields;
          if (fields && at === undefined)
            fields.push(result);
          else if (fields && at !== undefined)
            fields[at] = result;
        });
      }
    };
    return {
      type: 'list',
      heading: 'Form fields',
      emptyState: 'Only the name and dates are asked for.',
      items: type.fields.map((field, at): SettingDefinition => ({
        name: field.label || field.key,
        desc: [
          filled(field.label) && field.label !== field.key
            ? field.key
            : '',
          typeNames[field.type],
          field.required ? 'required' : '',
        ].filter(filled).join(' · ') + defaultText(field),
        action: () => void edit(at),
      })),
      addItem: {
        name: 'Add a field',
        action: () => void edit(),
      },
      extraButtons: type.template
        ? [
            (button: ExtraButtonComponent) => button.setIcon('file-input').setTooltip('Add the template\'s properties').onClick(() => void this.commit((profile) => {
              const kind = profile.types[index];
              if (kind)
                kind.fields.push(...this.suggest(kind));
            })),
          ]
        : [],
      onDelete: at => void this.commit((profile) => {
        profile.types[index]?.fields.splice(at, 1);
      }),
      onReorder: (from, to) => void this.commit((profile) => {
        const fields = profile.types[index]?.fields;
        const [moved] = fields?.splice(from, 1) ?? [];
        if (fields && moved)
          fields.splice(to, 0, moved);
      }),
    };
  }

  private kindRecognition(type: NoteType, index: number): SettingDefinitionItem {
    const bases = this.host.io.paths().filter(path => path.endsWith('.base'));
    const baseName = (path: string) => bases.filter(other => other.split('/').pop() === path.split('/').pop()).length > 1
      ? path
      : path.split('/').pop()?.replace(/\.base$/, '') ?? path;
    const baseOptions: Record<string, string> = { '': 'None' };
    if (type.basePath && !bases.includes(type.basePath))
      baseOptions[type.basePath] = `${baseName(type.basePath)} (missing)`;
    for (const path of bases) baseOptions[path] = baseName(path);
    const byBase = recognisedByBase(type);
    const text = (name: string, get: (kind: NoteType) => string, set: (kind: NoteType, value: string) => void) => ({
      type: 'text' as const,
      ...this.bindKind<string>(index, name, get, set),
    });
    return {
      type: 'group',
      heading: 'Recognition and property names',
      items: [
        {
          name: 'Base',
          desc: 'The Base this kind\'s notes appear in.',
          control: {
            type: 'dropdown',
            options: baseOptions,
            ...this.bindKind<string>(index, 'basePath', kind => kind.basePath, (kind, value) => {
              const follow = recognisedByBase(kind);
              kind.basePath = value;
              if (follow && value)
                recogniseByBase(kind);
              else if (follow)
                kind.recognition = { property: 'kind', value: kind.id };
            }),
          },
        },
        {
          name: 'Base link property',
          desc: differsFromShared(type, this.profile.types, 'base')
            ? `Other kinds use “${sharedValue(this.profile.types, 'base')}”.`
            : '',
          visible: !!type.basePath,
          control: text('baseProperty', kind => kind.baseProperty, (kind, value) => {
            const follow = recognisedByBase(kind);
            kind.baseProperty = value;
            if (follow)
              kind.recognition.property = value;
          }),
        },
        {
          name: 'Recognised by',
          desc: byBase
            ? `Notes whose “${type.baseProperty}” links to ${baseName(type.basePath)} are this kind.`
            : 'Notes with the property and value below are this kind.',
          visible: !!type.basePath,
          control: {
            type: 'dropdown',
            options: { base: 'Base link', property: 'Another property' },
            ...this.bindKind<string>(index, 'recognisedBy', kind => recognisedByBase(kind)
              ? 'base'
              : 'property', (kind, value) => {
              if (value === 'base')
                recogniseByBase(kind);
              else kind.recognition = { property: 'kind', value: kind.id };
            }),
          },
        },
        {
          name: 'Recognition property',
          desc: 'New notes get this property. Existing notes with it are recognised as this kind.',
          visible: !byBase,
          control: text('recognitionProperty', kind => kind.recognition.property, (kind, value) => { kind.recognition.property = value; }),
        },
        {
          name: 'Recognition value',
          visible: !byBase,
          control: text('recognitionValue', kind => kind.recognition.value, (kind, value) => { kind.recognition.value = value; }),
        },
        {
          name: 'Uses dates',
          desc: 'Notes of this kind have a start and end date.',
          control: {
            type: 'toggle',
            ...this.bindKind<boolean>(index, 'dated', kind => kind.dated, (kind, value) => { kind.dated = value; }),
          },
        },
        ...ownNames.filter(name => name.key !== 'parent' || type.role !== 'trip').map((name): SettingDefinition => ({
          name: name.label,
          desc: differsFromShared(type, this.profile.types, name.key)
            ? `${name.description} Other kinds use “${sharedValue(this.profile.types, name.key)}”.`.trim()
            : name.description,
          control: text(`mapping.${name.key}`, kind => kind.mappings[name.key], (kind, value) => { kind.mappings[name.key] = value; }),
        })),
        ...this.dayHeadings(type, index),
      ],
    };
  }

  private dayHeadings(type: NoteType, index: number): SettingDefinition[] {
    const entry = type.role === 'entry';
    return [
      {
        name: 'Day-heading format',
        desc: dayFormatHelp(type.days.dateFormat),
        visible: entry,
        control: {
          type: 'text',
          placeholder: 'YYYY-MM-DD',
          ...this.bindKind<string>(index, 'dateFormat', kind => kind.days.dateFormat, (kind, value) => { kind.days.dateFormat = value; }),
        },
      },
      {
        name: 'Day-heading level',
        visible: entry,
        control: {
          type: 'number',
          min: 1,
          max: 5,
          step: 1,
          ...this.bindKind<number>(index, 'headingLevel', kind => kind.days.headingLevel, (kind, value) => { kind.days.headingLevel = value; }),
        },
      },
      {
        name: 'Activity heading',
        desc: 'The subheading under each day that lists its activities.',
        visible: entry,
        control: {
          type: 'text',
          ...this.bindKind<string>(index, 'activityHeading', kind => kind.days.activityHeading, (kind, value) => { kind.days.activityHeading = value; }),
        },
      },
      {
        name: 'Activity-heading level',
        visible: entry,
        control: {
          type: 'number',
          min: 2,
          max: 6,
          step: 1,
          ...this.bindKind<number>(index, 'activityLevel', kind => kind.days.activityLevel, (kind, value) => { kind.days.activityLevel = value; }),
        },
      },
    ];
  }

  private suggest(type: NoteType): FieldDefinition[] {
    return suggestFields(this.host.io.snapshots().find(note => note.path === type.template)?.properties ?? {}, type);
  }

  /** Where templates live: the folder most kinds' templates are in. */
  private templateFolder(): string | undefined {
    const counts: Record<string, number> = {};
    for (const type of this.profile.types.filter(kind => kind.template)) {
      const folder = type.template.split('/').slice(0, -1).join('/');
      counts[folder] = (counts[folder] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  }

  /** Where the starter template goes: the core Templates folder if set, else an existing `_templates`, else `Templates`. */
  private starterFolder(): string {
    const core = (this.app as App & { internalPlugins?: { getPluginById: (id: string) => { instance?: { options?: { folder?: string } } } | null } })
      .internalPlugins
      ?.getPluginById('templates')
      ?.instance
      ?.options
      ?.folder
      ?.replace(/^\/+|\/+$/g, '');
    if (filled(core))
      return core;
    return this.app.vault.getAbstractFileByPath('_templates')
      ? '_templates'
      : 'Templates';
  }

  private async pickFolder(): Promise<string | undefined> {
    const folders = this.app.vault.getAllFolders(false).map(folder => folder.path).sort();
    return pick(this.app, folders.map(path => ({ value: path, label: path })), 'Folder your trips live in', query => ({
      value: normalizePath(query),
      label: `Use new folder “${query}”`,
    }));
  }

  private async pickTemplate(label: string, required: boolean): Promise<string | undefined> {
    const files = this.app.vault.getMarkdownFiles().map(file => file.path).sort().map(path => ({ value: path, label: path }));
    return pick(this.app, required
      ? files
      : [
          { value: '', label: 'No template', note: 'new notes get a minimal body' },
          ...files,
        ], `Template for ${label}`);
  }

  private uniqueId(base: string): string {
    let id = slug(base);
    let number = 2;
    while (this.profile.types.some(type => type.id === id)) id = `${slug(base)}-${number++}`;
    return id;
  }

  private async addKind(tripKind: boolean): Promise<void> {
    const role = tripKind
      ? 'trip'
      : await pick<NoteType['role']>(this.app, [
          { value: 'entry', label: 'Dated entry', note: 'Has start and end dates, like a day plan or a stop' },
          { value: 'activity', label: 'Activity', note: 'Collected for a trip and placed on days' },
        ], 'What kind of note?');
    if (!role)
      return;
    const template = await this.pickTemplate(role === 'trip'
      ? 'the new trip kind'
      : 'the new kind', role === 'trip');
    if (template === undefined)
      return;
    const fallback: Record<NoteType['role'], string> = { trip: 'New trip kind', activity: 'New activity kind', entry: 'New entry kind' };
    const label = (template && noteName(template)) || fallback[role];
    const id = this.uniqueId(label);
    const scope = this.profile.scopes[0];
    const folder = filled(scope)
      ? scope
      : 'Travel';
    const type: NoteType = {
      ...newType(id, role),
      label,
      template,
      recognition: { property: 'kind', value: id },
    };
    type.pathPattern = role === 'trip'
      ? `${folder}/{{trip_start_year}}/{{trip_name}}.md`
      : `${folder}/{{trip_start_year}}/{{trip_name}}/{{entry_name}}.md`;
    for (const { key } of sharedNames) {
      const value = sharedValue(this.profile.types, key);
      if (value && appliesTo(type, key))
        setProperty(type, key, value);
    }
    if (role === 'trip')
      type.contains = [];
    await this.commit(profile => profile.types.push(type));
  }

  private async removeKind(index: number | undefined): Promise<void> {
    const type = index === undefined
      ? undefined
      : this.profile.types[index];
    if (!type)
      return;
    const ok = await confirmAction(this.app, `Remove ${type.label}`, [`Notes of this kind stay as they are but won't be recognised as ${type.label} anymore. Its template and Base stay too.`], 'Remove');
    if (!ok)
      return;
    await this.commit((profile) => {
      profile.types.splice(index!, 1);
      for (const trip of profile.types) {
        if (trip.contains)
          trip.contains = trip.contains.filter(id => id !== type.id);
      }
    });
  }

  private async usePreset(): Promise<void> {
    try {
      const preview = await previewInstall(this.host.io);
      const profile = await new Promise<Profile | undefined>((resolve) => {
        this.modal = new PresetModal(this.app, this.host, preview, resolve);
        this.modal.open();
      });
      if (profile)
        await this.commit((draft) => { Object.assign(draft, profile); });
    }
    catch (error) { notify(String(error).replace(/^Error:\s*/, '')); }
  }

  /** Asks for the trip template, creating the starter one if chosen; returns its path and properties. */
  private async chooseOwnTemplate(): Promise<{ path: string; created: boolean; properties: Record<string, unknown> } | undefined> {
    const vault = this.app.vault;
    const starter = `${this.starterFolder()}/Trip.md`;
    const files = vault.getMarkdownFiles().map(file => file.path).sort().map(path => ({ value: path, label: path }));
    const offer = vault.getAbstractFileByPath(starter)
      ? []
      : [
          { value: starter, label: 'Create a starter template', note: `${starter}, with the start and end date already in place` },
        ];
    const path = await pick(this.app, [
      ...offer,
      ...files,
    ], 'Template for your trips');
    if (!filled(path))
      return undefined;
    if (offer.length > 0 && path === starter) {
      if (!vault.getAbstractFileByPath(this.starterFolder()))
        await vault.createFolder(this.starterFolder());
      await vault.create(starter, starterTemplate);
      return {
        path,
        created: true,
        properties: { startDate: '{{start_date}}', endDate: '{{end_date}}' },
      };
    }
    return { path, created: false, properties: this.host.io.snapshots().find(note => note.path === path)?.properties ?? {} };
  }

  private async useOwn(): Promise<void> {
    const chosen = await this.chooseOwnTemplate();
    if (!chosen)
      return;
    const { path, created, properties } = chosen;
    const found = dateProperties(properties);
    const dates = { start: found.start ?? found.named.start, end: found.end ?? found.named.end };
    if (!filled(found.start) || !filled(found.end)) {
      const missing = [
        filled(found.start)
          ? ''
          : `${dates.start ?? 'startDate'}: "{{start_date}}"`,
        filled(found.end)
          ? ''
          : `${dates.end ?? 'endDate'}: "{{end_date}}"`,
      ].filter(filled).join(' and ');
      const ok = await confirmAction(this.app, 'Add the date placeholders', [
        `New trips get their dates from placeholders in the template's properties, and ${path} is missing them.`,
        `Open it and set ${missing}. You can use it now and add them afterwards.`,
      ], 'Use it anyway', false);
      if (!ok)
        return;
    }
    const folder = await this.pickFolder();
    if (folder === undefined)
      return;
    const label = created
      ? 'Trip'
      : noteName(path) || 'Trip';
    const type: NoteType = {
      ...newType(slug(label)),
      label,
      template: path,
      contains: [],
      pathPattern: `${folder}/{{trip_start_year}}/{{trip_name}}.md`,
    };
    type.mappings = { ...type.mappings, start: dates.start ?? type.mappings.start, end: dates.end ?? type.mappings.end };
    type.fields = this.suggest(type);
    await this.commit((profile) => {
      Object.assign(profile, {
        name: 'My travel',
        scopes: [folder],
        types: [type],
      });
    });
  }

  private async changeFolder(): Promise<void> {
    const folder = this.profile.scopes[0] ?? '';
    const next = await this.pickFolder();
    if (!filled(next) || next === folder)
      return;
    const others = this.profile.scopes.slice(1).filter(scope => scope !== next);
    // Kinds saving somewhere else were set up that way on purpose; say so instead of moving them.
    const elsewhere = this.profile.types.filter(type => !folder || !type.pathPattern.startsWith(`${folder}/`)).map(type => type.label);
    const ok = await confirmAction(this.app, 'Change travel folder', [
      elsewhere.length
        ? `New notes saved under ${folder}/ will be saved under ${next}/ instead. ${elsewhere.join(', ')} ${elsewhere.length === 1
          ? 'keeps its'
          : 'keep their'} own save location.`
        : `New trips and their notes will be saved under ${next}/.`,
      folder
        ? `Trips already in ${folder}/ stay there and won't be found anymore unless you move them.`
        : '',
      others.length
        ? `Trips in ${others.join(', ')} are still found.`
        : '',
    ].filter(Boolean), 'Change folder');
    if (!ok)
      return;
    await this.commit((profile) => {
      for (const type of profile.types) {
        if (folder && type.pathPattern.startsWith(`${folder}/`))
          type.pathPattern = `${next}/${type.pathPattern.slice(folder.length + 1)}`;
      }
      profile.scopes = [next, ...others];
    });
  }

  private async startOver(): Promise<void> {
    const ok = await confirmAction(this.app, 'Start over', ['This forgets the setup: trip kinds, folders and property names. Your notes, templates and Bases stay as they are.', 'You then choose a setup again.'], 'Start over');
    if (ok)
      await this.commit((profile) => { Object.assign(profile, emptySettings().profile); });
  }

  private async revealFolder(path: string): Promise<void> {
    const folder = this.app.vault.getFolderByPath(path);
    const explorer = this.app.workspace.getLeavesOfType('file-explorer')[0];
    if (!folder || !explorer)
      return;
    // A file explorer that hasn't been shown since startup is still a placeholder without revealInFolder.
    await explorer.loadIfDeferred();
    const view = explorer.view as { revealInFolder?: (file: unknown) => void };
    if (!view.revealInFolder)
      return;
    (this.app as App & { setting?: { close: () => void } }).setting?.close();
    void this.app.workspace.revealLeaf(explorer);
    view.revealInFolder(folder);
  }
}
