<script lang='ts'>
  import type { CreationReport } from '../../creation/create';
  import type { NoteType } from '../../types';
  import type { ActivityChoice, FormDraft, TripChoice } from './modal';
  import { tick, untrack } from 'svelte';
  import { noteName, resolvePath } from '../../config/paths';
  import { validateName } from '../../config/validation';
  import { inclusiveDays } from '../../travel/dates';
  import { icon } from '../icon';
  import { dayLabel, rangeLabel } from '../itinerary/layout';
  import FieldInputs from './FieldInputs.svelte';
  import { parseFields, rangeProblems } from './fields';

  const { type, trip, initial, activities = [], pickActivity, exists, create: write, close, created }: {
    type: NoteType;
    /** The trip a new entry or activity belongs to; absent when creating a trip. */
    trip?: TripChoice;
    initial?: { name?: string; start?: string; end?: string };
    /** The trip's activities, offered when the kind keeps an activity list. */
    activities?: ActivityChoice[];
    pickActivity: (choices: ActivityChoice[]) => Promise<ActivityChoice | undefined>;
    exists: (path: string) => boolean;
    create: (draft: FormDraft) => Promise<CreationReport>;
    close: () => void;
    created: (report: CreationReport) => void;
  } = $props();
  let name = $state(untrack(() => initial?.name ?? ''));
  let start = $state(untrack(() => initial?.start ?? ''));
  let end = $state(untrack(() => initial?.end ?? ''));
  let fields: Record<string, string> = $state({});
  const chosen = $state<(ActivityChoice & { day: string })[]>([]);
  let report: CreationReport | undefined = $state();
  let error = $state('');
  let busy = $state(false);
  let attempted = $state(false);
  let root: HTMLDivElement;
  const id = $props.id();
  const isTrip = $derived(type.role === 'trip');
  // A creation can stop part-way: say what was written instead of claiming nothing was.
  const errorText = $derived.by(() => {
    const sentence = `${error}${/[.!?]$/.test(error)
      ? ''
      : '.'}`;
    return report?.failed && report.completed.length
      ? `${sentence} Created ${report.completed.map(noteName).join(', ')}; ${noteName(report.failed)} was not. Your input is still here.`
      : `${sentence} Nothing was written; your input is still here.`;
  });
  const nameErrors = $derived(name
    ? validateName(name)
    : ['Enter a name']);
  const showName = $derived(nameErrors.length > 0 && (name !== '' || attempted));
  const dates = $derived(rangeProblems(start, end, trip?.start, trip?.end));
  const missingDates = $derived(type.dated && attempted
    ? {
      start: start ? '' : 'Choose a start date',
      end: end ? '' : 'Choose an end date',
    }
    : { start: '', end: '' });
  const startProblem = $derived(dates.start || missingDates.start);
  const endProblem = $derived(dates.end || missingDates.end);
  const fieldsValid = $derived.by(() => {
    try {
      parseFields(type.fields, fields);
      return true;
    }
    catch { return false; }
  });
  // Days an activity can be listed under: the entry's own dates, once both are valid.
  const days = $derived(start && end && !dates.start && !dates.end
    ? inclusiveDays(start, end)
    : []);
  const keepsActivities = $derived(type.role === 'entry' && !!type.mappings.activities && !!trip);
  const pathPreview = $derived.by(() => {
    if (!name || nameErrors.length)
      return '';
    try {
      return resolvePath(type.pathPattern, {
        tripName: isTrip
          ? name
          : trip?.name ?? '',
        entryName: name,
        tripStart: isTrip ? start : trip?.start,
        isTrip,
      });
    }
    catch { return ''; }
  });
  const collision = $derived(!!pathPreview && exists(pathPreview));
  async function addActivity() {
    const choice = await pickActivity(activities.filter(item => !chosen.some(other => other.link === item.link)));
    if (choice)
      chosen.push({ ...choice, day: '' });
  }
  async function create() {
    attempted = true;
    await tick();
    if (nameErrors.length || startProblem || endProblem || !fieldsValid || collision) {
      root.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    busy = true;
    error = '';
    try {
      report = await write({
        name,
        start,
        end,
        fields: $state.snapshot(fields),
        activities: chosen.map(item => ({
          link: item.link,
          day: days.includes(item.day)
            ? item.day
            : undefined,
        })),
      });
      if (!report.failed) {
        created(report);
        return;
      }
      error = report.error?.replace(/^Error:\s*/, '') ?? 'Creation failed';
    }
    catch (failure) { error = String(failure).replace(/^Error:\s*/, ''); }
    finally { busy = false; }
    await tick();
    root.querySelector<HTMLElement>('[role="alert"]')?.focus();
  }
</script>
<div class='travel-planner travel-form' bind:this={root}>
  {#if trip && !isTrip}<p class='setting-item-description'>In {trip.name}{trip.start && trip.end
    ? ` · ${rangeLabel(trip.start, trip.end)}`
    : ''}</p>{/if}
  {#if error}<p role='alert' tabindex='-1'>{errorText}</p>{/if}
  <fieldset disabled={busy}>
    <label for={`${id}-name`}>Name</label>
    <input id={`${id}-name`} type='text' bind:value={name}
           aria-invalid={showName || collision} aria-describedby={showName || collision
             ? `${id}-name-error`
             : undefined} />
    {#if showName}<p id={`${id}-name-error`} class='travel-field-error' role='status'>{nameErrors.join('; ')}</p>
    {:else if collision}<p id={`${id}-name-error`} class='travel-field-error' role='status'>A note already exists at <code>{pathPreview}</code>. Choose another name.</p>
    {:else if pathPreview}<p class='setting-item-description' aria-live='polite'>Saves to <code>{pathPreview}</code></p>{/if}
    {#if type.dated}
      <div class='travel-date-pair'>
        <div><label for={`${id}-start`}>Start date</label>
          <input id={`${id}-start`} type='date' value={start} onchange={event => start = event.currentTarget.value} min={trip?.start} max={trip?.end}
                 aria-invalid={!!startProblem} aria-describedby={startProblem
                   ? `${id}-start-error`
                   : undefined} />
          {#if startProblem}<p id={`${id}-start-error`} class='travel-field-error' role='status'>{startProblem}</p>{/if}</div>
        <div><label for={`${id}-end`}>End date</label>
          <input id={`${id}-end`} type='date' value={end} onchange={event => end = event.currentTarget.value} min={start || trip?.start} max={trip?.end}
                 aria-invalid={!!endProblem} aria-describedby={endProblem
                   ? `${id}-end-error`
                   : undefined} />
          {#if endProblem}<p id={`${id}-end-error`} class='travel-field-error' role='status'>{endProblem}</p>{/if}</div>
      </div>
    {/if}
    <FieldInputs fields={type.fields} bind:values={fields} {attempted} />
    {#if keepsActivities}
      <span class='travel-field-label'>Activities</span>
      {#if chosen.length}
        <ul class='travel-chosen'>{#each chosen as item, index (item.link)}
          <li><span>{item.label}</span>
            {#if days.length}<label class='travel-sr' for={`${id}-day-${index}`}>Day for {item.label}</label><select id={`${id}-day-${index}`} class='dropdown' value={days.includes(item.day)
              ? item.day
              : ''} onchange={event => item.day = event.currentTarget.value}>
              <option value="">No day yet</option>{#each days as day (day)}<option value={day}>{dayLabel(day)}</option>{/each}</select>{/if}
            <button class='clickable-icon' aria-label={`Remove ${item.label}`} onclick={() => chosen.splice(index, 1)}><span use:icon={'x'}></span></button></li>
        {/each}</ul>
      {/if}
      {#if activities.length > chosen.length}<button onclick={addActivity}>Add activity…</button>
      {:else if !activities.length}<p class='setting-item-description'>This trip has no activities yet. Add them from the trip tab.</p>{/if}
    {/if}
    <div class='modal-button-container'><button onclick={close}>Cancel</button><button class='mod-cta' onclick={create}>{busy ? 'Creating…' : 'Create'}</button></div>
  </fieldset>
</div>
