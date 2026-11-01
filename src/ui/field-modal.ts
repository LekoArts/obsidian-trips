import type { App } from 'obsidian';
import type { FieldDefinition } from '../types';
import { Modal } from 'obsidian';
import { mount, unmount } from 'svelte';
import { labelDialog } from './dialog';
import FieldForm from './FieldForm.svelte';

/** Edits one form property in a small dialog; resolves with the result, or undefined when cancelled. */
export async function editField(app: App, field: FieldDefinition, title: string): Promise<FieldDefinition | undefined> {
  return new Promise((resolve) => {
    let result: FieldDefinition | undefined;
    let component: ReturnType<typeof mount> | undefined;
    new (class extends Modal {
      onOpen(): void {
        labelDialog(this, title);
        component = mount(FieldForm, {
          target: this.contentEl,
          props: {
            initial: field,
            cancel: () => this.close(),
            done: (value: FieldDefinition) => {
              result = value;
              this.close();
            },
          },
        });
      }

      onClose(): void {
        if (component)
          void unmount(component);
        this.contentEl.empty();
        resolve(result);
      }
    })(app).open();
  });
}
