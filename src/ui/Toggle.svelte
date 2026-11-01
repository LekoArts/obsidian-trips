<script lang='ts'>
  import { ToggleComponent } from 'obsidian';
  import { onMount } from 'svelte';

  let { checked = $bindable(false), id, disabled = false }: { checked?: boolean; id: string; disabled?: boolean } = $props();
  let container: HTMLDivElement;
  let component = $state.raw<ToggleComponent>();
  onMount(() => {
    component = new ToggleComponent(container).onChange((value) => {
      if (value !== checked)
        checked = value;
    });
    // The focusable element is Obsidian's toggle container; expose it as a named switch with state.
    component.toggleEl.setAttribute('role', 'switch');
    component.toggleEl.setAttribute('aria-labelledby', `${id}-label`);
    const input = component.toggleEl.querySelector('input');
    if (input) {
      input.id = id;
      input.tabIndex = -1;
      input.setAttribute('aria-hidden', 'true');
    }
    return () => {
      // eslint-disable-next-line svelte/no-dom-manipulating -- Obsidian's ToggleComponent owns this element's children, not Svelte.
      container.replaceChildren();
    };
  });
  $effect(() => {
    component?.setValue(checked).setDisabled(disabled);
    component?.toggleEl.setAttribute('aria-checked', String(checked));
    component?.toggleEl.setAttribute('aria-disabled', String(disabled));
  });
</script>
<div bind:this={container}></div>
