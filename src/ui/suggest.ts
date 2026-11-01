import type { App, FuzzyMatch } from 'obsidian';
import { FuzzySuggestModal } from 'obsidian';
import { filled } from '../config/validation';

export interface Choice<T> { value: T; label: string; note?: string }
class ChoiceModal<T> extends FuzzySuggestModal<Choice<T>> {
  chosen = false;
  constructor(app: App, private choices: Choice<T>[], placeholder: string, private done: (value: T | undefined) => void, private create?: (query: string) => Choice<T>) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getItems(): Choice<T>[] { return this.choices; }
  getSuggestions(query: string): FuzzyMatch<Choice<T>>[] {
    const matches = super.getSuggestions(query);
    // The typed text as a new item, last, like Obsidian's own "create note" in the quick switcher.
    if (this.create && query.trim()) {
      matches.push({
        item: this.create(query),
        match: { score: 0, matches: [] },
      });
    }
    return matches;
  }

  getItemText(item: Choice<T>): string {
    return filled(item.note)
      ? `${item.label} ${item.note}`
      : item.label;
  }

  renderSuggestion(match: FuzzyMatch<Choice<T>>, el: HTMLElement): void {
    el.createDiv({ text: match.item.label });
    if (filled(match.item.note))
      el.createEl('small', { text: match.item.note, cls: 'travel-suggestion-note' });
  }

  onChooseItem(item: Choice<T>): void {
    this.chosen = true;
    this.done(item.value);
  }

  onClose(): void {
    // Obsidian closes the modal before reporting the chosen item, so "nothing chosen" is decided a microtask later.
    queueMicrotask(() => {
      if (!this.chosen)
        this.done(undefined);
    });
  }
}
/** Obsidian's own fuzzy picker; resolves undefined when dismissed. */
export async function pick<T>(app: App, choices: Choice<T>[], placeholder: string, create?: (query: string) => Choice<T>): Promise<T | undefined> {
  return new Promise(resolve => new ChoiceModal(app, choices, placeholder, resolve, create).open());
}
