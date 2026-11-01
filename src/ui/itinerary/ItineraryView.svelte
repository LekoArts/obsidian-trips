<script lang='ts'>
  import type { HoverParent } from 'obsidian';
  import type { BatchPlan, BatchReport } from '../../editing/batch';
  import type { Span } from '../../travel/schedule';
  import type { Choice } from '../suggest';
  import type { DayActivity, DaySlot, EntryRow, TripDay } from './layout';
  import type { ItineraryHost, ItineraryModel, ItineraryNote, TabState } from './model';
  import { Keymap, Menu, Platform } from 'obsidian';
  import { onMount, tick, untrack } from 'svelte';
  import { noteName } from '../../config/paths';
  import { undoPlan } from '../../editing/batch';
  import { dayOffset } from '../../travel/dates';
  import { rangeProblems } from '../creation/fields';
  import { icon } from '../icon';
  import { pick } from '../suggest';
  import { dayLabel, freeStretch, rangeLabel, shiftSpan, stepTarget, tripDays, tripLayout } from './layout';
  import { loadItinerary, tripPaths } from './model';
  import { applyPlan, assignmentPlan, extensionPlan, movePlan, OutsideTrip, removalPlan, spanPlan } from './operations';

  const { host, initialPath, stateChanged }: { host: ItineraryHost; initialPath: string; stateChanged: (state: TabState) => void } = $props();
  let path = $state(untrack(() => initialPath));
  let model: ItineraryModel | undefined = $state.raw();
  let busy = $state(false);
  let loadError = $state('');
  /** Paths being written right now; their rows are dimmed and inert. */
  let touched: string[] = $state([]);
  /** The last change, with Undo while it can still be undone. Stays until the next change. */
  let last: { plan?: BatchPlan; message: string; focus: string } | undefined = $state.raw();
  // The result bar goes away on its own after a while, like a toast, but not while the pointer or focus is on it.
  const BAR_SECONDS = 8;
  let bar: HTMLElement | undefined = $state();
  $effect(() => {
    const shown = last;
    if (!shown)
      return;
    let timer = 0;
    const hide = () => {
      if (bar?.matches(':hover, :focus-within'))
        timer = window.setTimeout(hide, 1000);
      else if (last === shown)
        last = undefined;
    };
    timer = window.setTimeout(hide, BAR_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  });
  /** A multi-file change that stopped part-way. */
  let partial: { plan: BatchPlan; report: BatchReport; message: string; focus: string } | undefined = $state.raw();
  /** What the partial bar says, kept apart so one live region can always exist and only its text change. */
  const partialText = $derived(partial
    ? `Stopped at ${noteName(partial.report.failed ?? '')}: ${partial.report.error?.replace(/^Error: /, '')}. Written: ${partial.report.completed.map(noteName).join(', ')}. Not written: ${partial.report.untouched.map(noteName).join(', ') || 'none'}.`
    : '');
  /** Shown at the row the edit was made on; nothing was written. */
  let blocked: { anchor: string; message: string; extend?: { range: Span; plan: () => BatchPlan; focus: string; back: string } } | undefined = $state.raw();
  let editingDates = $state(false);
  /** The entry whose length and dates panel is open. */
  let datesOpen: string | undefined = $state();
  // A new note reaches the index on the next vault refresh; these act once the trip tab can see it.
  let waits: (() => void)[] = [];
  const message = (failure: unknown) => String(failure).replace(/^Error: /, '');
  let tripStart = $state('');
  let tripEnd = $state('');
  const tripDatesProblem = $derived(!tripStart || !tripEnd
    ? 'Enter both dates'
    : rangeProblems(tripStart, tripEnd).end);
  let root: HTMLElement | undefined = $state();
  let generation = 0;
  const layout = $derived(model
    ? tripLayout(model, host.io.paths())
    : undefined);
  const days = $derived(layout && model
    ? tripDays(layout, model.trip)
    : undefined);
  const activityKind = $derived(model?.activityKind);
  const creatable = $derived(model
    ? model.kinds.filter(type => model!.creatable.includes(type.id))
    : []);
  /** Entries that have no bar: undated kinds. Broken dates show under Needs attention instead. */
  const undated = $derived(layout
    ? layout.entries.filter(row => !row.valid && !row.note.type.dated)
    : []);
  const isPhone = Platform.isPhone;
  async function reload() {
    const current = ++generation;
    if (!path) {
      model = undefined;
      return;
    }
    try {
      const next = await loadItinerary(host, path);
      if (current !== generation)
        return;
      model = next;
      loadError = '';
    }
    catch (failure) {
      if (current === generation) {
        loadError = message(failure);
        model = undefined;
      }
    }
  }
  onMount(() => {
    const unsubscribe = host.subscribe(() => {
      if (!busy)
        void reload();
    });
    return () => {
      generation++;
      unsubscribe();
      for (const finish of [...waits]) finish();
    };
  });
  // Freshness checks say the file changed; anything else (permissions, disk) is reported as it is.
  const notWritten = (report: BatchReport, undoing = false) => {
    const name = noteName(report.failed ?? '');
    const result = undoing ? 'Undo didn\'t change anything' : 'nothing was written';
    return /changed|refresh/i.test(report.error ?? '')
      ? `${name} changed ${undoing ? 'after that' : 'since this tab read it'}, so ${result}.`
      : `${name} couldn't be written (${message(report.error ?? '').replace(/\.$/, '')}), so ${result}.`;
  };
  const focusKey = () => {
    const active = root?.ownerDocument.activeElement;
    return active instanceof HTMLElement
      ? active.dataset.focus ?? ''
      : '';
  };
  async function focus(key: string) {
    await tick();
    const target = key
      ? root?.querySelector<HTMLElement>(`[data-focus="${CSS.escape(key)}"]`)
      : undefined;
    (target ?? root?.querySelector<HTMLElement>('.travel-trip-title button'))?.focus();
  }

  // The same note can be linked twice on one day; each bullet still needs its own key.
  function occurrenceKey(list: { path?: string; link: string }[], index: number): string {
    const id = (item: { path?: string; link: string }) => item.path ?? item.link;
    const own = id(list[index]!);
    return `${own}#${list.slice(0, index).filter(item => id(item) === own).length}`;
  }
  /**
   * Every edit goes through here: written at once, then the bar offers Undo. The stale-file check runs inside
   * applyPlan before each write; a change that stops part-way keeps its report with Retry and Undo.
   * `focusBefore` is where Undo sends focus back to; `resuming` marks a Retry of the same plan.
   */
  async function apply(plan: BatchPlan, done: string, anchor: string, focusAfter: string, focusBefore = focusKey(), resuming = false) {
    if (!model || busy)
      return;
    if (partial && !resuming) {
      blocked = { anchor, message: 'Retry, undo or dismiss the interrupted change at the bottom first.' };
      return;
    }
    busy = true;
    blocked = undefined;
    touched = plan.steps.map(step => step.before.path);
    try {
      const report = await applyPlan(host, model, plan);
      // Declined in Obsidian's delete prompt: nothing was written and there is nothing to report.
      if (!report.cancelled) {
        if (report.failed && !report.completed.length && !resuming) {
          blocked = {
            anchor,
            message: notWritten(report),
          };
        }
        else if (report.failed) {
          partial = {
            plan,
            report,
            message: done,
            focus: focusAfter,
          };
        }
        else {
          partial = undefined;
          last = {
            plan: plan.steps.some(step => step.kind === 'trash')
              ? undefined
              : plan,
            message: done,
            focus: focusBefore,
          };
        }
      }
    }
    catch (failure) {
      blocked = {
        anchor,
        message: message(failure),
      };
    }
    finally {
      busy = false;
      touched = [];
    }
    await reload();
    await focus(blocked ? focusBefore : focusAfter);
  }
  /** Builds the change first; a refusal (outside the trip, no such day…) shows at the row and writes nothing. */
  function attempt(anchor: string, build: () => BatchPlan, done: (plan: BatchPlan) => string, focusAfter: string, extend?: () => BatchPlan, focusBefore = focusKey()) {
    if (!model || busy)
      return;
    blocked = undefined;
    if (partial) {
      blocked = { anchor, message: 'Retry, undo or dismiss the interrupted change at the bottom first.' };
      return;
    }
    let plan: BatchPlan;
    try {
      plan = build();
    }
    catch (failure) {
      blocked = failure instanceof OutsideTrip && extend
        ? {
          anchor,
          message: failure.message,
          extend: {
            range: failure.range,
            plan: extend,
            focus: focusAfter,
            back: focusBefore,
          },
        }
        : {
          anchor,
          message: message(failure),
        };
      return;
    }
    void apply(plan, done(plan), anchor, focusAfter, focusBefore);
  }
  const summaries = (plan: BatchPlan) => plan.steps.map(step => step.summary).join(' ');
  async function undo() {
    if (!last?.plan || busy || !model)
      return;
    let plan: BatchPlan;
    try {
      plan = undoPlan(last.plan);
    }
    catch (failure) {
      last = {
        message: message(failure),
        focus: last.focus,
      };
      return;
    }
    const back = last.focus;
    busy = true;
    touched = plan.steps.map(step => step.before.path);
    try {
      const report = await applyPlan(host, model, plan);
      last = report.failed && !report.completed.length
        ? {
          message: notWritten(report, true),
          focus: back,
        }
        : report.failed
        ? undefined
        : { message: 'Undone.', focus: back };
      if (report.failed && report.completed.length) {
        partial = {
          plan,
          report,
          message: 'Undone.',
          focus: back,
        };
      }
    }
    catch (failure) {
      last = {
        message: message(failure),
        focus: back,
      };
    }
    finally {
      busy = false;
      touched = [];
    }
    await reload();
    await focus(back);
  }
  async function retry() {
    if (partial) {
      const { plan, message: done, focus: after } = partial;
      await apply(plan, done, 'trip', after, focusKey(), true);
    }
  }
  async function undoPartial() {
    if (partial) {
      last = { plan: partial.plan, message: '', focus: partial.focus };
      partial = undefined;
      await undo();
    }
  }

  function openNote(notePath: string, event?: MouseEvent) {
    // Mod-click and middle-click open where Obsidian's own links would. A plain click opens beside the
    // trip tab on desktop, so changes show up in the note right away; phones have one pane.
    const modded = event
      ? Keymap.isModEvent(event)
      : false;
    void host.app.workspace.openLinkText(notePath, path, modded !== false
      ? modded
      : !isPhone && 'split');
  }
  const uid = $props.id();
  const hoverParent: HoverParent = { hoverPopover: null };
  /** A note's name as a link: click and mod-click open it, hovering shows Obsidian's page preview. */
  function noteLink(el: HTMLElement, notePath: string) {
    let target = notePath;
    const open = (event: MouseEvent) => {
      if (event.type === 'auxclick' && event.button !== 1)
        return;
      event.preventDefault();
      openNote(target, event);
    };
    const hover = (event: MouseEvent) => host.app.workspace.trigger('hover-link', {
      event,
      source: 'trips',
      hoverParent,
      targetEl: el,
      linktext: target,
      sourcePath: path,
    });
    el.addEventListener('click', open);
    el.addEventListener('auxclick', open);
    el.addEventListener('mouseover', hover);
    return {
      update: (next: string) => {
        target = next;
      },
      destroy: () => {
        el.removeEventListener('click', open);
        el.removeEventListener('auxclick', open);
        el.removeEventListener('mouseover', hover);
      },
    };
  }
  type MenuItems = Pick<Menu, 'addItem' | 'addSeparator'>;
  /** Opens a menu; for a note, Obsidian and other plugins add their file actions below ours. */
  function showMenu(event: MouseEvent, build: (menu: MenuItems) => void, notePath?: string) {
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();
    // Obsidian orders sections by first use, so ours, added first, stay on top. Once a menu has
    // sections it only separates those, so each of our groups is its own section.
    let group = 0;
    const ours: MenuItems = {
      addItem: callback => menu.addItem((item) => {
        item.setSection(`trips-${group}`);
        callback(item);
      }),
      addSeparator: () => {
        group++;
        return menu;
      },
    };
    build(ours);
    const file = notePath === undefined
      ? null
      : host.app.vault.getFileByPath(notePath);
    if (file) {
      menu.addSeparator();
      host.app.workspace.trigger('file-menu', menu, file, 'trips');
    }
    if (event.type === 'contextmenu' || event.detail > 0) {
      menu.showAtMouseEvent(event);
    }
    else {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom });
    }
  }
  async function switchTrip() {
    const choices: Choice<string>[] = tripPaths(host).map(item => ({
      value: item,
      label: noteName(item),
      note: item,
    }));
    const next = await pick(host.app, choices, 'Switch to which trip?');
    if (!next || next === path || busy)
      return;
    path = next;
    last = undefined;
    partial = undefined;
    blocked = undefined;
    stateChanged({ path });
    await reload();
  }
  async function trash(note: ItineraryNote, anchor: string) {
    const name = noteName(note.snapshot.path);
    // Obsidian asks (or not, per its "Confirm file deletion" setting) once the file is checked for changes.
    attempt(anchor, () => removalPlan(host, model!, note, 'trash'), () => `Deleted ${name}.`, '');
  }
  function relationItems(menu: MenuItems, note: ItineraryNote, anchor: string) {
    const name = noteName(note.snapshot.path);
    if (note.type.role !== 'trip') {
      menu.addItem(item => item.setTitle(note.parentPath ? 'Detach from trip' : 'Attach to this trip').setIcon(note.parentPath ? 'unlink' : 'link').onClick(() => attempt(anchor, () => removalPlan(host, model!, note, note.parentPath ? 'detach' : 'attach'), () => note.parentPath
        ? `Detached ${name}. Its note stays; it no longer shows in this trip's Bases.`
        : `Attached ${name} to this trip.`, '')));
    }
    menu.addItem(item => item.setTitle('Delete…').setIcon('trash').setWarning(true).onClick(() => void trash(note, anchor)));
  }

  // Rows held by a drag, a picker or a menu may predate the last refresh; act on the current one for that note.
  const fresh = (row: EntryRow): EntryRow => layout?.entries.find(entry => entry.note.snapshot.path === row.note.snapshot.path) ?? row;
  const inTrip = (date: string) => !!days?.days.length && date >= days.days[0]!.date && date <= days.days.at(-1)!.date;
  // Where a refusal about a day shows: its row, or the "Outside the trip" list for days the tab doesn't show.
  const dayAnchor = (date: string) => inTrip(date)
    ? `day:${date}`
    : 'beyond';
  const waitForRecovery = (anchor: string) => {
    if (partial)
      blocked = { anchor, message: 'Retry, undo or dismiss the interrupted change at the bottom first.' };
    return !!partial;
  };

  // ── Entries ──
  const entryKey = (row: EntryRow) => `entry:${row.note.snapshot.path}`;
  function setEntry(held: EntryRow, next: Span, focusAfter = entryKey(held)) {
    const row = fresh(held);
    if (!model || (next.start === row.note.start && next.end === row.note.end))
      return;
    attempt(`entry:${row.note.snapshot.path}`, () => spanPlan(model!, row.note, next), summaries, focusAfter, () => spanPlan(model!, row.note, next, true), focusAfter);
  }
  const moveEntry = (held: EntryRow, days: number) => {
    const row = fresh(held);
    setEntry(row, shiftSpan(row.note, days));
  };
  /** One night longer or shorter: the last day moves, as when a stay is extended. */
  function resize(held: EntryRow, days: number) {
    const row = fresh(held);
    const key = row.note.snapshot.path;
    const next = { start: row.note.start, end: shiftSpan(row.note, days).end };
    if (next.start > next.end) {
      blocked = { anchor: `entry:${key}`, message: `${row.name} can't be shorter than one day.` };
      return;
    }
    setEntry(row, next, datesOpen === key
      ? `${days > 0
        ? 'longer'
        : 'shorter'}:${key}`
      : entryKey(row));
  }
  function newEntry(typeId: string, dates: Span) {
    if (!model || busy || waitForRecovery(`day:${dates.start}`))
      return;
    host.openCreation({
      typeId,
      parentPath: model.trip.snapshot.path,
      initial: dates,
      openIn: isPhone ? 'tab' : 'split',
    });
  }
  function entryKeys(event: KeyboardEvent, row: EntryRow) {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown'))
      return;
    event.preventDefault();
    const step = event.key === 'ArrowUp'
      ? -1
      : 1;
    if (event.shiftKey)
      resize(row, step); else
      moveEntry(row, step);
  }
  // Length and dates of an entry, edited in a small panel under its name, as travel apps edit a stay.
  const nights = (row: EntryRow) => {
    const n = dayOffset(row.note.start, row.note.end);
    return n === 0
      ? '1 day'
      : n === 1
      ? '1 night'
      : `${n} nights`;
  };
  async function openDates(row: EntryRow) {
    datesOpen = row.note.snapshot.path;
    await tick();
    root?.querySelector<HTMLInputElement>(`[data-focus="from:${CSS.escape(row.note.snapshot.path)}"]`)?.focus();
  }
  async function closeDates(row: EntryRow, refocus = true) {
    if (datesOpen !== row.note.snapshot.path)
      return;
    datesOpen = undefined;
    if (refocus) {
      await tick();
      root?.querySelector<HTMLElement>(`[data-focus="len:${CSS.escape(row.note.snapshot.path)}"]`)?.focus();
    }
  }
  function dateInput(held: EntryRow, edge: 'start' | 'end', value: string) {
    const row = fresh(held);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      return;
    const next = edge === 'start'
      ? { start: value, end: row.note.end }
      : { start: row.note.start, end: value };
    if (next.start > next.end) {
      blocked = {
        anchor: `entry:${row.note.snapshot.path}`,
        message: edge === 'start'
          ? 'The first day must be on or before the last day.'
          : 'The last day must be on or after the first day.',
      };
      return;
    }
    setEntry(row, next, `${edge === 'start'
      ? 'from'
      : 'to'}:${row.note.snapshot.path}`);
  }
  function entryMenu(event: MouseEvent, row: EntryRow) {
    showMenu(event, (menu) => {
      menu.addItem(item => item.setTitle('Open note').setIcon('file-text').onClick(() => openNote(row.note.snapshot.path)));
      if (row.valid) {
        menu.addSeparator();
        menu.addItem(item => item.setTitle('One day earlier').setIcon('arrow-up').onClick(() => moveEntry(row, -1)));
        menu.addItem(item => item.setTitle('One day later').setIcon('arrow-down').onClick(() => moveEntry(row, 1)));
        menu.addItem(item => item.setTitle('One night longer').setIcon('plus').onClick(() => resize(row, 1)));
        if (row.note.start < row.note.end)
          menu.addItem(item => item.setTitle('One night shorter').setIcon('minus').onClick(() => resize(row, -1)));
        menu.addItem(item => item.setTitle('Change dates…').setIcon('calendar').onClick(() => void openDates(row)));
        for (const type of creatable) menu.addItem(item => item.setTitle(`New ${type.label} from ${dayLabel(row.note.end)}`).setIcon('calendar-plus').onClick(() => newEntry(type.id, { start: row.note.end, end: row.note.end })));
      }
      menu.addSeparator();
      relationItems(menu, row.note, `entry:${row.note.snapshot.path}`);
    }, row.note.snapshot.path);
  }

  // ── Activities ──
  const activityKey = (row: EntryRow, date: string, target: string) => `act:${row.note.snapshot.path}:${date}:${target}`;
  type Source = { row?: EntryRow; date?: string; path: string; name: string };
  /** Puts an activity on `date` in `to` at `index` (end when omitted). Leaving another entry is part of the same change. */
  function place(held: Source, heldTo: EntryRow, date: string, index?: number) {
    if (!model)
      return;
    const source = { ...held, row: held.row && fresh(held.row) };
    const to = fresh(heldTo);
    if (!inTrip(date)) {
      blocked = {
        anchor: source.date
          ? dayAnchor(source.date)
          : 'unplanned',
        message: `${dayLabel(date)} is outside the trip. Change the trip dates to plan it.`,
      };
      return;
    }
    const anchor = `day:${date}`;
    const focusAfter = activityKey(to, date, source.path);
    const back = source.row && source.date
      ? activityKey(source.row, source.date, source.path)
      : `plan:${source.path}`;
    const from = source.row && source.date
      ? { row: source.row, date: source.date }
      : undefined;
    const same = from && from.row.note.snapshot.path === to.note.snapshot.path;
    attempt(anchor, () => movePlan(host, model!, source.path, to, date, from, index), same
      ? summaries
      : () => `${from ? 'Moved' : 'Put'} ${source.name} ${from ? 'to' : 'on'} ${dayLabel(date)}${to.name !== from?.row.name
        ? ` (${to.name})`
        : ''}.`, focusAfter, undefined, back);
  }
  function takeOff(row: EntryRow, date: string, activity: DayActivity) {
    if (!activity.path)
      return;
    attempt(dayAnchor(date), () => assignmentPlan(host, model!, row.note, { action: 'day-remove', target: activity.path!, day: date }), summaries, `plan:${activity.path}`, undefined, activityKey(row, date, activity.path));
  }
  function step(row: EntryRow, date: string, activity: DayActivity, direction: -1 | 1) {
    if (!activity.path || !days)
      return;
    const slot = days.days.find(day => day.date === date)?.slots.find(s => s.row.note === row.note);
    const target = stepTarget(days, row, date, slot?.activities.indexOf(activity) ?? -1, direction);
    if ('refused' in target) {
      blocked = {
        anchor: dayAnchor(date),
        message: target.refused,
      };
      return;
    }
    place({
      row,
      date,
      path: activity.path,
      name: activity.name,
    }, target.row, target.date, target.index);
  }
  function activityKeys(event: KeyboardEvent, row: EntryRow, date: string, activity: DayActivity) {
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      step(row, date, activity, event.key === 'ArrowUp'
        ? -1
        : 1);
    }
    else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      takeOff(row, date, activity);
    }
  }
  const activityChoices = (exclude: string[] = []): Choice<string>[] => (model?.activities ?? []).filter(note => !exclude.includes(note.snapshot.path)).map(note => ({
    value: note.snapshot.path,
    label: noteName(note.snapshot.path),
  }));
  function newActivity(name: string, then?: (created: string) => void) {
    if (!model || !activityKind || busy || waitForRecovery('unplanned'))
      return;
    host.openCreation({
      typeId: activityKind.id,
      parentPath: model.trip.snapshot.path,
      initial: { name },
      openIn: isPhone ? 'tab' : 'split',
      onCreated: (paths) => {
        if (paths[0] && then)
          waitFor(paths[0], then);
      },
    });
  }
  function waitFor(created: string, then: (created: string) => void) {
    let done = false;
    let unsubscribe = () => {};
    let timer = 0;
    const finish = () => {
      done = true;
      unsubscribe();
      window.clearTimeout(timer);
      waits = waits.filter(wait => wait !== finish);
    };
    unsubscribe = host.subscribe(async () => {
      await reload();
      if (!done && model?.activities.some(note => note.snapshot.path === created)) {
        finish();
        then(created);
      }
    });
    timer = window.setTimeout(() => {
      if (done)
        return;
      finish();
      blocked = { anchor: 'unplanned', message: `Created ${noteName(created)}, but it didn't appear here in time to be placed. Put it on a day from Not on a day.` };
    }, 5000);
    waits.push(finish);
  }
  async function addActivity(slot: DaySlot, date: string) {
    const choice = await pick<{ path?: string; create?: string }>(host.app, activityChoices(slot.activities.flatMap(a => a.path
      ? [a.path]
      : [])).map(item => ({
      ...item,
      value: { path: item.value },
    })), `Add an activity on ${dayLabel(date)}`, activityKind
      ? query => ({
        value: { create: query },
        label: `Create activity "${query}"`,
      })
      : undefined);
    if (choice?.create !== undefined) {
      newActivity(choice.create, created => place({
        path: created,
        name: noteName(created),
      }, slot.row, date));
      return;
    }
    if (choice?.path) {
      place({
        path: choice.path,
        name: noteName(choice.path),
      }, slot.row, date);
    }
  }
  async function chooseDay(source: Source, title: string) {
    if (!days)
      return;
    const choices = days.days.flatMap(day => day.slots.map(slot => ({
      value: { slot, date: day.date },
      label: `${dayLabel(day.date)} · ${slot.row.name}`,
    })));
    const choice = await pick(host.app, choices, title);
    if (choice)
      place(source, choice.slot.row, choice.date);
  }
  function unplannedMenu(event: MouseEvent, activity: ItineraryNote) {
    const name = noteName(activity.snapshot.path);
    const source = { path: activity.snapshot.path, name };
    showMenu(event, (menu) => {
      menu.addItem(item => item.setTitle('Open note').setIcon('file-text').onClick(() => openNote(activity.snapshot.path)));
      menu.addItem(item => item.setTitle('Put on a day…').setIcon('calendar').onClick(() => void chooseDay(source, `Put ${name} on…`)));
      menu.addSeparator();
      relationItems(menu, activity, 'unplanned');
    }, activity.snapshot.path);
  }
  function activityMenu(event: MouseEvent, row: EntryRow, date: string, activity: DayActivity) {
    showMenu(event, (menu) => {
      if (activity.path)
        menu.addItem(item => item.setTitle('Open note').setIcon('file-text').onClick(() => openNote(activity.path!)));
      if (!activity.path)
        return;
      const source = {
        row,
        date,
        path: activity.path,
        name: activity.name,
      };
      menu.addSeparator();
      menu.addItem(item => item.setTitle('Earlier').setIcon('arrow-up').onClick(() => step(row, date, activity, -1)));
      menu.addItem(item => item.setTitle('Later').setIcon('arrow-down').onClick(() => step(row, date, activity, 1)));
      menu.addItem(item => item.setTitle('Move to day…').setIcon('calendar').onClick(() => void chooseDay(source, `Move ${activity.name} to…`)));
      menu.addItem(item => item.setTitle(`Take off ${dayLabel(date)}`).setIcon('x').onClick(() => takeOff(row, date, activity)));
      menu.addItem(item => item.setTitle(`Remove from ${row.name}`).setIcon('trash-2').onClick(() => attempt(dayAnchor(date), () => assignmentPlan(host, model!, row.note, { action: 'full-remove', target: activity.path! }), summaries, '')));
    }, activity.path);
  }

  // ── Drag and drop (desktop). Phones use the menus. ──
  type Drag = { kind: 'activity'; source: Source } | { kind: 'entry'; row: EntryRow };
  let drag: Drag | undefined = $state.raw();
  let over = $state('');
  function startDrag(event: DragEvent, value: Drag) {
    if (busy) {
      event.preventDefault();
      return;
    }
    drag = value;
    event.dataTransfer?.setData('text/plain', value.kind === 'entry'
      ? value.row.name
      : value.source.name);
    if (event.dataTransfer)
      event.dataTransfer.effectAllowed = 'move';
  }
  function endDrag() {
    drag = undefined;
    over = '';
  }
  const accepts = (slot?: DaySlot) => drag?.kind === 'entry' || (drag?.kind === 'activity' && !!slot);
  function dragOver(event: DragEvent, key: string, ok: boolean) {
    if (!ok)
      return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer)
      event.dataTransfer.dropEffect = 'move';
    over = key;
  }
  function dropOnDay(event: DragEvent, day: TripDay) {
    event.preventDefault();
    const value = drag;
    endDrag();
    if (value?.kind !== 'entry')
      return;
    const row = fresh(value.row);
    setEntry(row, shiftSpan(row.note, dayOffset(row.note.start, day.date)));
  }
  /** `index`: dropped before the activity at that position; otherwise at the end of the day. */
  function dropOnSlot(event: DragEvent, slot: DaySlot, date: string, index?: number) {
    event.preventDefault();
    event.stopPropagation();
    const value = drag;
    endDrag();
    if (value?.kind === 'entry') {
      const day = days?.days.find(d => d.date === date);
      if (day) {
        drag = value;
        dropOnDay(event, day);
      }
      return;
    }
    if (value?.kind !== 'activity')
      return;
    const { source } = value;
    // Within the same day the list is counted without the dragged item.
    const from = source.row?.note.snapshot.path === slot.row.note.snapshot.path && source.date === date
      ? slot.activities.findIndex(a => a.path === source.path)
      : -1;
    const at = index !== undefined && from >= 0 && from < index
      ? index - 1
      : index;
    if (from >= 0 && (at ?? slot.activities.length - 1) === from)
      return;
    place(source, slot.row, date, at);
  }
  function dropOnUnplanned(event: DragEvent) {
    event.preventDefault();
    const value = drag;
    endDrag();
    if (value?.kind === 'activity' && value.source.row && value.source.date)
      takeOff(value.source.row, value.source.date, { path: value.source.path, name: value.source.name, link: '' });
  }
  // The draft starts from the trip's dates when the editor opens; later refreshes don't overwrite it.
  function editDates() {
    if (busy || !model)
      return;
    tripStart = model.trip.start;
    tripEnd = model.trip.end;
    editingDates = true;
  }
  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && editingDates) {
      event.stopPropagation();
      editingDates = false;
    }
  }
</script>

{#snippet refusal(anchor: string)}
  {#if blocked?.anchor === anchor}
    {@const extend = blocked.extend}
    <div class='travel-refusal' role='alert'>
      <span>{blocked.message}</span>
      {#if extend}<button class='mod-cta' disabled={busy} onclick={() => {
        const plan = extend.plan();
        void apply(plan, summaries(plan), anchor, extend.focus, extend.back);
      }}>Extend trip to {rangeLabel(extend.range.start, extend.range.end)}</button>{/if}
      <button class='clickable-icon' aria-label='Dismiss' onclick={() => blocked = undefined}><span use:icon={'x'}></span></button>
    </div>
  {/if}
{/snippet}

{#snippet activityItem(row: EntryRow, date: string, activity: DayActivity, stray: boolean, beyond = false, hint = '')}
  {@const key = activityKey(row, date, activity.path ?? activity.link)}
  {@const where = beyond
    ? `${dayLabel(date)} in ${row.name}, outside the trip`
    : `outside ${row.name}`}
  <li class='travel-activity' class:is-stray={stray} draggable={!!activity.path && !isPhone && !busy}
      ondragstart={event => startDrag(event, {
        kind: 'activity',
        source: {
          row,
          date,
          path: activity.path!,
          name: activity.name,
        },
      })} ondragend={endDrag}
      ondragover={event => !stray && dragOver(event, key, drag?.kind === 'activity')}
      ondrop={(event) => {
        if (stray)
          return;
        const slot = days?.days.find(d => d.date === date)?.slots.find(s => s.row.note.snapshot.path === row.note.snapshot.path);
        if (slot)
          dropOnSlot(event, slot, date, slot.activities.indexOf(activity));
      }}
      class:is-drop-before={over === key}>
    <span class='travel-grip' aria-hidden='true'>{activity.path ? '⠿' : ''}</span>
    {#if activity.path}
      <button class='travel-activity-name' data-focus={key} aria-describedby={`${uid}-activity-keys`}
              use:noteLink={activity.path} onkeydown={event => activityKeys(event, row, date, activity)} oncontextmenu={event => activityMenu(event, row, date, activity)}>{activity.name}</button>
      {#if stray}<span class='travel-stray-note'>{where}</span>{/if}
      <button class='clickable-icon travel-hover' aria-label={`Take ${activity.name} off ${dayLabel(date)}`} onclick={() => takeOff(row, date, activity)}><span use:icon={'x'}></span></button>
      <button class='clickable-icon travel-hover' aria-label={`More actions for ${activity.name}`} onclick={event => activityMenu(event, row, date, activity)}><span use:icon={'more-horizontal'}></span></button>
    {:else}
      {@const why = activity.matches
        ? `${activity.matches} notes are called ${activity.name}`
        : `No note is called ${activity.name}`}
      {@const help = activity.matches
        ? `${why}. Obsidian opens one of them, maybe another trip's. Write the link with its folder to say which.`
        : `${why}. Create it or fix the link in ${row.name}.`}
      {@const whyId = `${uid}-why-${hint.replace(/\W+/g, '-')}`}
      <span class='travel-activity-name is-unresolved' aria-describedby={whyId}>{activity.name}</span>
      <span id={whyId} class='travel-sr'>{help} It can't be moved here until then.</span>
      <span class='travel-stray-note' aria-hidden='true'>{activity.matches
        ? `${activity.matches} notes with this name`
        : 'no such note'}</span>
    {/if}
  </li>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section bind:this={root} class='travel-itinerary' class:is-dragging={!!drag} aria-labelledby={`${uid}-title`} aria-busy={busy} onkeydown={onKeydown}>
  <span id={`${uid}-activity-keys`} hidden>Alt+Up or Alt+Down to move, Delete to take off this day</span>
  <span id={`${uid}-entry-keys`} hidden>Alt+Up or Alt+Down to move, Alt+Shift+Up or Down for one night less or more</span>
  <span id={`${uid}-days`} hidden>Days</span>
  {#if !model}
    <h2 class='travel-trip-title' id={`${uid}-title`}>Trip itinerary</h2>
    {#if loadError}<p role='alert'>{loadError}</p>{/if}
    <button class='mod-cta' onclick={switchTrip}>Choose a trip</button>
  {:else if layout && days}
    <header class='travel-trip-header'>
      <div class='travel-trip-summary'>
        <h2 class='travel-trip-title' id={`${uid}-title`}><button class='travel-link-button' data-focus='trip' use:noteLink={model.trip.snapshot.path}>{noteName(model.trip.snapshot.path)}<span class='travel-open' aria-hidden='true' use:icon={'arrow-up-right'}></span></button></h2>
        <button class='travel-link-button travel-trip-dates' data-focus='tripdates' onclick={editDates}>{model.trip.start || model.trip.end
          ? rangeLabel(model.trip.start, model.trip.end)
          : 'Set trip dates'}{#if model.trip.start || model.trip.end}<span class='travel-sr'>. Trip dates, change</span>{/if}</button>
        <button class='clickable-icon' aria-label='Trip actions' onclick={event => showMenu(event, (menu) => {
          menu.addItem(item => item.setTitle('Switch trip…').setIcon('arrow-left-right').onClick(() => void switchTrip()));
          menu.addItem(item => item.setTitle('Change trip dates').setIcon('calendar').onClick(editDates));
          menu.addSeparator();
          relationItems(menu, model!.trip, 'trip');
        })}><span use:icon={'more-horizontal'}></span></button>
      </div>
      {#if editingDates}
        <div class='travel-inline-actions'>
          <label>Start <input type='date' value={tripStart} onchange={event => tripStart = event.currentTarget.value} /></label>
          <label>End <input type='date' min={tripStart || undefined} value={tripEnd} onchange={event => tripEnd = event.currentTarget.value} aria-invalid={tripDatesProblem ? 'true' : 'false'} aria-describedby={tripDatesProblem ? 'travel-trip-dates-error' : undefined} /></label>
          <button class='mod-cta' disabled={!!tripDatesProblem || busy} onclick={() => {
            editingDates = false;
            attempt('trip', () => extensionPlan(model!, tripStart, tripEnd), () => `Trip now ${rangeLabel(tripStart, tripEnd)}.`, 'tripdates');
          }}>Save</button>
          <button onclick={() => {
            editingDates = false;
            void focus('tripdates');
          }}>Cancel</button>
          {#if tripDatesProblem}<p id='travel-trip-dates-error' class='travel-field-error' role='alert'>{tripDatesProblem}</p>{/if}
        </div>
      {/if}
    </header>
    {@render refusal('trip')}

    {#if layout.attention.length}
      <section class='travel-attention' aria-labelledby='travel-attention'>
        <h3 id='travel-attention'>Needs attention</h3>
        <ul>{#each layout.attention as item, index (`${item.path}:${index}`)}
          {@const row = layout.entries.find(row => row.note.snapshot.path === item.path)}
          <li><button class='travel-link-button' use:noteLink={item.path}><strong>{item.name}</strong></button> {item.message}
            {#if row?.valid && model.trip.start && (row.note.end < model.trip.start || row.note.start > model.trip.end)}
              <button class='travel-link-button' onclick={() => moveEntry(row, dayOffset(row.note.start, model!.trip.start))}>Move to {dayLabel(model.trip.start)}</button>{@render refusal(`entry:${row.note.snapshot.path}`)}
            {/if}</li>
        {/each}</ul>
      </section>
    {/if}

    {#if !model.kinds.length && !activityKind && !model.activities.length}
      <p class='setting-item-description'>This kind of trip has no dated entries or activities to plan here. Edit it in its note.</p>
    {:else if days.days.length}
      {#if model.activities.length || activityKind}
        <section class='travel-pool' class:is-over={over === 'unplanned'} aria-labelledby='travel-unplanned'
                 ondragover={event => dragOver(event, 'unplanned', drag?.kind === 'activity' && !!drag.source.row)} ondragleave={() => {
                   if (over === 'unplanned')
                     over = '';
                 }} ondrop={dropOnUnplanned}>
          <h3 id='travel-unplanned'>Not on a day {#if layout.unplanned.length}<span class='travel-count'>({layout.unplanned.length})</span>{/if}</h3>
          {@render refusal('unplanned')}
          <ul class='travel-activities'>
            {#each layout.unplanned as activity (activity.snapshot.path)}
              {@const name = noteName(activity.snapshot.path)}
              {@const source = { path: activity.snapshot.path, name }}
              <li class='travel-activity' draggable={!isPhone && !busy && days.days.some(d => d.slots.length)} ondragstart={event => startDrag(event, { kind: 'activity', source })} ondragend={endDrag}>
                <span class='travel-grip' aria-hidden='true'>⠿</span>
                <button class='travel-activity-name' data-focus={`plan:${activity.snapshot.path}`} use:noteLink={activity.snapshot.path}
                        oncontextmenu={event => unplannedMenu(event, activity)}>{name}</button>
                <button class='clickable-icon travel-hover' aria-label={`Put ${name} on a day`} disabled={!days.days.some(d => d.slots.length)} onclick={() => void chooseDay(source, `Put ${name} on…`)}><span use:icon={'calendar-plus'}></span></button>
                <button class='clickable-icon travel-hover' aria-label={`More actions for ${name}`} onclick={event => unplannedMenu(event, activity)}><span use:icon={'more-horizontal'}></span></button>
              </li>
            {/each}
          </ul>
          {#if activityKind}<button class='travel-link-button' disabled={busy} onclick={() => newActivity('')}>+ {activityKind.label}</button>{/if}
        </section>
      {/if}
      <ol aria-labelledby={`${uid}-days`}>
        {#each days.days as day (day.date)}
          <li class='travel-day' class:is-over={over === `day:${day.date}`}
              ondragover={event => dragOver(event, `day:${day.date}`, drag?.kind === 'entry')} ondragleave={() => {
                if (over === `day:${day.date}`)
                  over = '';
              }} ondrop={event => dropOnDay(event, day)}>
            <div class='travel-day-label'>
              <span id={`${uid}-day-${day.date}`}>{dayLabel(day.date)}</span>
              {#if day.overlap}<span class='travel-overlap' role='img' aria-label={day.overlap} use:icon={'alert-triangle'}></span>{/if}
            </div>
            <div class='travel-day-body'>
              {#if !day.slots.length}
                <div class='travel-free'>
                  <span class='travel-faint'>Nothing planned</span>
                  {#each creatable as type (type.id)}<button class='travel-link-button' data-focus={`new:${day.date}:${type.id}`} disabled={busy} onclick={() => newEntry(type.id, freeStretch(days!, day.date))}>+ {type.label}<span class='travel-sr'>{` from ${dayLabel(day.date)}`}</span></button>{/each}
                </div>
              {/if}
              {#each day.slots as slot (slot.row.note.snapshot.path)}
                {@const row = slot.row}
                {@const key = row.note.snapshot.path}
                <div class='travel-slot travel-tone-{slot.tone}' class:is-busy={touched.includes(key)} inert={touched.includes(key)}
                     role='group' aria-labelledby={`${uid}-slot-${key}-${day.date}`}
                     ondragover={event => dragOver(event, `slot:${day.date}:${key}`, accepts(slot))} ondrop={event => dropOnSlot(event, slot, day.date)} class:is-over={over === `slot:${day.date}:${key}`}>
                  <span id={`${uid}-slot-${key}-${day.date}`} hidden>{row.name}, {dayLabel(day.date)}</span>
                  <div class='travel-entry-head'>
                    {#if slot.head}
                      <button class='travel-entry-name' data-focus={entryKey(row)} draggable={!isPhone && !busy}
                              aria-describedby={`${uid}-entry-keys`}
                              ondragstart={event => startDrag(event, { kind: 'entry', row })} ondragend={endDrag}
                              use:noteLink={key} onkeydown={event => entryKeys(event, row)} oncontextmenu={event => entryMenu(event, row)}>{row.name}</button>
                      <button class='travel-link-button travel-length' data-focus={`len:${key}`} aria-expanded={datesOpen === key}
                              onclick={() => datesOpen === key
                                ? closeDates(row)
                                : openDates(row)}>{nights(row)}<span class='travel-sr'>, {rangeLabel(row.note.start, row.note.end)}. Change dates</span></button>
                    {:else}
                      <span class='travel-entry-cont' aria-hidden='true'>{row.name}</span>
                    {/if}
                    {#if model.activities.length || activityKind}
                      <button class='clickable-icon travel-hover' data-focus={`add:${day.date}:${key}`} aria-label={`Add an activity on ${dayLabel(day.date)} in ${row.name}`} disabled={busy} onclick={() => addActivity(slot, day.date)}><span use:icon={'plus'}></span></button>
                    {/if}
                    {#if slot.head}<button class='clickable-icon travel-hover' aria-label={`More actions for ${row.name}`} onclick={event => entryMenu(event, row)}><span use:icon={'more-horizontal'}></span></button>{/if}
                  </div>
                  {#if slot.head && datesOpen === key}
                    <div class='travel-dates' role='group' aria-labelledby={`${uid}-dates-${key}`}
                         onkeydown={(event) => {
                           if (event.key === 'Escape') {
                             event.preventDefault();
                             event.stopPropagation();
                             void closeDates(row);
                           }
                         }}
                         onfocusout={(event) => {
                           if (!busy && !event.currentTarget.contains(event.relatedTarget as Node | null) && !(event.relatedTarget as HTMLElement | null)?.closest?.('.travel-length'))
                             void closeDates(row, false);
                         }}>
                      <span id={`${uid}-dates-${key}`} hidden>Dates of {row.name}</span>
                      <label>First day <input type='date' data-focus={`from:${key}`} value={row.note.start} max={row.note.end} disabled={busy} onchange={event => dateInput(row, 'start', event.currentTarget.value)}></label>
                      <label>Last day <input type='date' data-focus={`to:${key}`} value={row.note.end} min={row.note.start} disabled={busy} onchange={event => dateInput(row, 'end', event.currentTarget.value)}></label>
                      <span class='travel-stepper'>
                        <button class='clickable-icon' data-focus={`shorter:${key}`} aria-label='One night shorter' disabled={busy || row.note.start === row.note.end} onclick={() => resize(row, -1)}><span use:icon={'minus'}></span></button>
                        <span aria-live='polite'>{nights(row)}</span>
                        <button class='clickable-icon' data-focus={`longer:${key}`} aria-label='One night longer' disabled={busy} onclick={() => resize(row, 1)}><span use:icon={'plus'}></span></button>
                      </span>
                    </div>
                  {/if}
                  {#if slot.head}{@render refusal(`entry:${key}`)}{/if}
                  <ul class='travel-activities'>
                    {#each slot.activities as activity, index (occurrenceKey(slot.activities, index))}
                      {@render activityItem(row, day.date, activity, false, false, occurrenceKey(slot.activities, index))}
                    {/each}
                  </ul>
                </div>
              {/each}
              {#if day.stray.length}
                <ul class='travel-activities'>
                  {#each day.stray as item, index (`${item.row.note.snapshot.path}:${item.activity.path ?? item.activity.link}:${index}`)}{@render activityItem(item.row, day.date, item.activity, true, false, `${day.date}-${index}`)}{/each}
                </ul>
              {/if}
              {@render refusal(`day:${day.date}`)}
            </div>
          </li>
        {/each}
      </ol>
      {#if undated.length || model.detached.length || days.beyond.length}
        <div class='travel-extras'>
          {#if days.beyond.length}
            <section aria-labelledby='travel-beyond'>
              <h3 id='travel-beyond'>Outside the trip</h3>
              {@render refusal('beyond')}
              <ul class='travel-activities'>{#each days.beyond as item, index (`${item.row.note.snapshot.path}:${item.date}:${item.activity.path ?? item.activity.link}:${index}`)}{@render activityItem(item.row, item.date, item.activity, true, true, `${item.date}-${index}`)}{/each}</ul>
            </section>
          {/if}
          {#if undated.length}
            <section aria-labelledby='travel-undated'>
              <h3 id='travel-undated'>Without dates</h3>
              <ul class='travel-activities'>{#each undated as row (row.note.snapshot.path)}<li class='travel-activity'><button class='travel-activity-name' use:noteLink={row.note.snapshot.path} oncontextmenu={event => entryMenu(event, row)}>{row.name}</button></li>{/each}</ul>
            </section>
          {/if}
          {#if model.detached.length}
            <section aria-labelledby='travel-detached'>
              <h3 id='travel-detached'>Detached notes in this trip's folder</h3>
              {@render refusal('detached')}
              <ul class='travel-activities'>
                {#each model.detached as note (note.snapshot.path)}
                  {@const name = noteName(note.snapshot.path)}
                  <li class='travel-activity'>
                    <button class='travel-activity-name' use:noteLink={note.snapshot.path}>{name}</button>
                    <button class='travel-link-button' onclick={() => attempt('detached', () => removalPlan(host, model!, note, 'attach'), () => `Attached ${name} to this trip.`, '')}>Attach</button>
                    <button class='clickable-icon' aria-label={`Move ${name} to the trash`} onclick={() => void trash(note, 'detached')}><span use:icon={'trash'}></span></button>
                  </li>
                {/each}
              </ul>
            </section>
          {/if}
        </div>
      {/if}
    {/if}

    <span class='travel-sr' role='alert'>{partialText}</span>
    <span class='travel-sr' role='status'>{last?.message ?? ''}</span>
    {#if partial}
      <div class='travel-bar'>
        <span>{partialText}</span>
        <button class='mod-cta' disabled={busy} onclick={retry}>Retry</button>
        <button disabled={busy} onclick={undoPartial}>Undo</button>
        <button disabled={busy} onclick={() => { partial = undefined; }}>Dismiss</button>
      </div>
    {:else if last}
      <div class='travel-bar' bind:this={bar}>
        <span>{last.message}</span>
        {#if last.plan}<button disabled={busy} onclick={undo}>Undo</button>{/if}
      </div>
    {/if}
  {/if}
</section>
