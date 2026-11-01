<script lang='ts'>
  import type { FileSnapshot } from '../../editing/conflicts';
  import type { FieldDefinition } from '../../types';
  import { untrack } from 'svelte';
  import FieldInputs from './FieldInputs.svelte';
  import { fieldText, parseFields, rangeProblems } from './fields';

  const { initial, initialProperties, fields, dates, save, refresh, close }: {
    initial: FileSnapshot;
    initialProperties: Record<string, unknown>;
    fields: FieldDefinition[];
    /** The start/end property keys and, for notes inside a trip, the trip's dates. */
    dates?: { start: string; end: string; min?: string; max?: string };
    save: (snapshot: FileSnapshot, changes: Record<string, unknown>) => Promise<void>;
    refresh: () => Promise<{ snapshot: FileSnapshot; properties: Record<string, unknown> }>;
    close: () => void;
  } = $props();
  let snapshot = $state(untrack(() => initial));
  let original = $state(untrack(() => initialProperties));
  const toValues = (properties: Record<string, unknown>) => Object.fromEntries(fields.map(field => [
    field.key,
    fieldText(properties[field.key]),
  ]));
  let values = $state(untrack(() => toValues(initialProperties)));
  let error = $state('');
  let busy = $state(false);
  let conflict = $state(false);
  let root: HTMLDivElement;
  const message = (failure: unknown) => String(failure).replace(/^Error:\s*/, '');
  const errorText = $derived(conflict
    ? 'The note changed since you opened this. Nothing was saved. Reload from file to see the change, then save again.'
    : `${error}${/[.!?]$/.test(error)
      ? ''
      : '.'} Your changes are still here.`);
  const range = $derived(dates
    ? rangeProblems(values[dates.start] ?? '', values[dates.end] ?? '', dates.min, dates.max)
    : { start: '', end: '' });
  const problems = $derived(dates
    ? { [dates.start]: range.start, [dates.end]: range.end }
    : {});
  const limits = $derived(dates
    ? {
      [dates.start]: { min: dates.min, max: dates.max },
      [dates.end]: { min: values[dates.start] || dates.min, max: dates.max },
    }
    : {});
  async function submit() {
    error = '';
    // Dates that were already out of range don't block unrelated edits; changing them must fix them.
    const datesChanged = dates && [dates.start, dates.end].some(key => values[key] !== fieldText(original[key]));
    if (datesChanged && (range.start || range.end)) {
      root.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    let changes: Record<string, unknown>;
    try {
      const changed = fields.filter(field => values[field.key] !== fieldText(original[field.key]));
      changes = Object.fromEntries(changed.map(field => [
        field.key,
        values[field.key] === '' && !field.required
          ? null
          : parseFields([field], values)[field.key],
      ]));
    }
    catch (failure) {
      error = message(failure);
      return;
    }
    if (!Object.keys(changes).length) {
      close();
      return;
    }
    busy = true;
    try {
      await save($state.snapshot(snapshot), changes);
      close();
    }
    catch (failure) {
      error = message(failure);
      conflict = /changed|unsaved/i.test(error);
    }
    finally { busy = false; }
  }
  async function reload() {
    busy = true;
    // Reloading keeps edits to fields the other change didn't touch.
    try {
      const result = await refresh();
      const edited = fields.filter(field => values[field.key] !== fieldText(original[field.key]));
      snapshot = result.snapshot;
      original = result.properties;
      values = {
        ...toValues(original),
        ...Object.fromEntries(edited.map(field => [field.key, values[field.key] ?? ''])),
      };
      error = '';
      conflict = false;
    }
    catch (failure) { error = message(failure); }
    finally { busy = false; }
  }
</script>
<div class='travel-planner travel-form' bind:this={root}>
  <p class='setting-item-description'><code>{snapshot.path}</code></p>
  {#if error}<p role='alert'>{errorText}</p>{/if}
  <fieldset disabled={busy}>
    <FieldInputs {fields} bind:values={values} {limits} {problems} />
    {#if dates}<p class='setting-item-description'>Only properties change. Dates you typed in the note itself stay as they are.</p>{/if}
    <div class='modal-button-container'>
      {#if conflict}<button onclick={reload}>Reload from file</button>{/if}
      <button onclick={close}>Cancel</button><button class='mod-cta' onclick={submit}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  </fieldset>
</div>
