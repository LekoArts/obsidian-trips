import { Notice } from 'obsidian';

/** Shows a notice; 0 keeps it until dismissed. */
export function notify(message: string, timeout?: number): Notice {
  return new Notice(message, timeout);
}
