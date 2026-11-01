import type { App } from 'obsidian';
import { ConfirmationModal } from 'obsidian';
import { labelDialog } from './dialog';

/**
 * Obsidian's confirmation dialog: what happens, then Cancel and the action. A destructive action is red and Cancel
 * takes focus, so Enter never destroys anything by accident. Resolves true only when the action is chosen.
 */
export async function confirmAction(app: App, title: string, body: string[], action: string, warning = true): Promise<boolean> {
  return new Promise((resolve) => {
    let confirmed = false;
    const modal = new ConfirmationModal(app);
    labelDialog(modal, title);
    for (const text of body) modal.contentEl.createEl('p', { text });
    modal.addButton((button) => {
      button.setButtonText('Cancel').setCancel();
      if (warning)
        button.setInitialFocus();
    });
    modal.addButton((button) => {
      button.setButtonText(action).onClick(() => {
        confirmed = true;
      });
      if (warning)
        button.setDestructive().setCta();
      else button.setCta().setInitialFocus();
    });
    modal.setCloseCallback(() => resolve(confirmed));
    modal.open();
  });
}
