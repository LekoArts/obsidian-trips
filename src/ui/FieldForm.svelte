<script lang='ts'>
  import type { FieldDefinition, FieldType } from '../types';
  import { untrack } from 'svelte';
  import SettingRow from './SettingRow.svelte';
  import Toggle from './Toggle.svelte';

  const { initial, done, cancel }: { initial: FieldDefinition; done: (field: FieldDefinition) => void; cancel: () => void } = $props();
  const field = $state<FieldDefinition>(untrack(() => structuredClone($state.snapshot(initial)) as FieldDefinition));
  const fieldTypes: { value: FieldType; label: string }[] = [
    { value: 'text', label: 'Text' },
    { value: 'number', label: 'Number' },
    { value: 'boolean', label: 'Yes / no' },
    { value: 'date', label: 'Date' },
    { value: 'url', label: 'Web address' },
    { value: 'text-list', label: 'List' },
    { value: 'note-link', label: 'Link to a note' },
    { value: 'note-link-list', label: 'Links to notes' },
  ];
  const problem = $derived(!field.key.trim()
    ? 'Enter the property name used in the note.'
    : '');
  let attempted = $state(false);
  function save() {
    attempted = true;
    if (!problem) {
      done({
        ...$state.snapshot(field),
        label: field.label.trim() || field.key.trim(),
        key: field.key.trim(),
      });
    }
  }
</script>
<div class='travel-planner travel-configuration'>
  <SettingRow name='Property' description="The name in the note's frontmatter, e.g. Location.">
    {#snippet children(id, description)}<input {id} aria-describedby={description} aria-invalid={attempted && !!problem} type='text' bind:value={field.key} />{/snippet}
  </SettingRow>
  {#if attempted && problem}<p class='travel-field-error' role='status'>{problem}</p>{/if}
  <SettingRow name='Label' description='Shown in the form. Leave empty to use the property name.'>
    {#snippet children(id, description)}<input {id} aria-describedby={description} type='text' bind:value={field.label} />{/snippet}
  </SettingRow>
  <SettingRow name='Type'>
    {#snippet children(id)}<select {id} class='dropdown' bind:value={field.type}>{#each fieldTypes as kind (kind.value)}<option value={kind.value}>{kind.label}</option>{/each}</select>{/snippet}
  </SettingRow>
  <SettingRow name='Required' description="A note can't be created while this is empty.">
    {#snippet children(id)}<Toggle {id} bind:checked={field.required} />{/snippet}
  </SettingRow>
  {#if field.type === 'boolean'}
    <SettingRow name='Starts as'>{#snippet children(id)}<Toggle {id} bind:checked={() => field.defaultValue === true, value => field.defaultValue = value} />{/snippet}</SettingRow>
  {:else if field.type === 'number'}
    <SettingRow name='Default'>{#snippet children(id)}<input {id} type='number' value={typeof field.defaultValue === 'number'
      ? field.defaultValue
      : ''} oninput={event => field.defaultValue = event.currentTarget.value === ''
      ? undefined
      : Number(event.currentTarget.value)} />{/snippet}</SettingRow>
  {:else if field.type.endsWith('-list')}
    <SettingRow name='Default' description='One value per line.' stacked>{#snippet children(id, description)}<textarea {id} aria-describedby={description} value={Array.isArray(field.defaultValue)
      ? field.defaultValue.join('\n')
      : ''} oninput={event => field.defaultValue = event.currentTarget.value
      ? event.currentTarget.value.split('\n')
      : []}></textarea>{/snippet}</SettingRow>
  {:else}
    <SettingRow name='Default'>{#snippet children(id)}<input {id} type={field.type === 'date'
      ? 'date'
      : 'text'} value={typeof field.defaultValue === 'string'
      ? field.defaultValue
      : ''} oninput={event => field.defaultValue = event.currentTarget.value || undefined} />{/snippet}</SettingRow>
  {/if}
  <div class='modal-button-container'><button onclick={cancel}>Cancel</button><button class='mod-cta' onclick={save}>Done</button></div>
</div>
