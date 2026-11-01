import type { Modal } from 'obsidian';

/** Obsidian modals carry no dialog semantics; name each one by its visible header title. */
export function labelDialog(modal: Modal, title: string): void {
  const id = `travel-dialog-title-${crypto.randomUUID()}`;
  modal.titleEl.textContent = title;
  modal.titleEl.id = id;
  modal.modalEl.setAttribute('role', 'dialog');
  modal.modalEl.setAttribute('aria-modal', 'true');
  modal.modalEl.setAttribute('aria-labelledby', id);
}
