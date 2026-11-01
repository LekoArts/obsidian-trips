<script lang='ts'>
  import type { Snippet } from 'svelte';

  const { name, description = '', more, children, stacked = false, action = false }: {
    name: string;
    description?: string;
    children: Snippet<[string, string]>;
    stacked?: boolean;
    /** Description content that needs markup, such as code. */
    more?: Snippet;
    /** The control is a button: the name isn't its label, so hovering or clicking the row doesn't press it. */
    action?: boolean;
  } = $props();
  const id = $props.id();
</script>
<!-- tabindex="-1" matches native rows: Obsidian's settings keyboard navigation focuses rows. -->
<div class='setting-item' class:travel-setting-stacked={stacked} class:travel-setting-action={action} role='group' aria-labelledby={`${id}-label`} tabindex='-1'>
  <div class='setting-item-info'>
    {#if action}<div class='setting-item-name' id={`${id}-label`}>{name}</div>
    {:else}<label class='setting-item-name' id={`${id}-label`} for={id}>{name}</label>{/if}
    {#if description || more}<div class='setting-item-description' id={`${id}-description`}>{description}{@render more?.()}</div>{/if}
  </div>
  <div class='setting-item-control'>
    {@render children(id, `${id}-description`)}
  </div>
</div>
