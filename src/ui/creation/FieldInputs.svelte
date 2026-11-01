<script lang='ts'>
  import type { FieldDefinition } from '../../types';
  import Toggle from '../Toggle.svelte';
  import { fieldProblem, fieldText, parseFields, urlLike } from './fields';

  let { fields, values = $bindable(), limits = {}, problems = {}, attempted = false }: {
    fields: FieldDefinition[];
    values: Record<string, string>;
    /** Date pickers start and stop at these dates (e.g. the trip's range). */
    limits?: Record<string, { min?: string; max?: string }>;
    /** Problems found outside this component, such as an end date before the start date. */
    problems?: Record<string, string>;
    /** After a submit attempt, every problem shows, including empty required fields. */
    attempted?: boolean;
  } = $props();
  const id = $props.id();
  const text = (field: FieldDefinition) => values[field.key] ?? fieldText(field.defaultValue);
  function submitProblem(field: FieldDefinition): string {
    try {
      parseFields([field], values);
      return '';
    }
    catch (error) {
      return error instanceof Error
        ? error.message
        : String(error);
    }
  }
  const problem = (field: FieldDefinition) => problems[field.key] || fieldProblem(field, text(field)) || (attempted
    ? submitProblem(field)
    : '');
  const placeholder = (field: FieldDefinition) => urlLike(field)
    ? 'https://…'
    : field.type === 'note-link'
    ? '[[Note name]]'
    : '';
</script>
{#each fields as field, index (field.key)}
  {@const fieldId = `${id}-${index}`}
  {#if field.type === 'boolean'}
    <div class='travel-toggle-field'><span id={`${fieldId}-label`}>{field.label}</span>
      <Toggle id={fieldId} bind:checked={() => text(field) === 'true', value => values[field.key] = String(value)} /></div>
  {:else}
    <label for={fieldId}>{field.label}{field.required ? ' (required)' : ''}</label>
    {#if field.type.endsWith('-list')}
      <textarea id={fieldId} rows='2' placeholder={field.type === 'note-link-list'
        ? '[[Note name]]\n[[Another note]]'
        : 'One per line'} aria-invalid={!!problem(field)} aria-describedby={problem(field)
        ? `${fieldId}-error`
        : undefined} value={text(field)} oninput={event => values[field.key] = event.currentTarget.value}></textarea>
    {:else}
      <input id={fieldId} type={field.type === 'number'
        ? 'number'
        : field.type === 'date'
        ? 'date'
        : 'text'} inputmode={urlLike(field)
        ? 'url'
        : undefined}
             placeholder={placeholder(field)} min={limits[field.key]?.min} max={limits[field.key]?.max}
             aria-invalid={!!problem(field)} aria-describedby={problem(field)
               ? `${fieldId}-error`
               : undefined}
             value={text(field)} {...{
               [field.type === 'date'
                 ? 'onchange'
                 : 'oninput']: (event: Event & { currentTarget: HTMLInputElement }) => values[field.key] = event.currentTarget.value,
             }} />
    {/if}
    {#if problem(field)}<p id={`${fieldId}-error`} class='travel-field-error' role='status'>{problem(field)}</p>{/if}
  {/if}
{/each}
