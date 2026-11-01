import { setIcon } from 'obsidian';

/** Svelte action: paints an Obsidian icon into the element, so markup stays free of inline SVG. */
export function icon(element: HTMLElement, name: string): void {
  setIcon(element, name);
}
