import type { NoteType } from '../types';
import { filled } from './validation';

/** True when a kind is recognised by its Base link: the recognition property is the Base link property and its value links to the kind's Base. */
export function recognisedByBase(type: NoteType): boolean {
  if (!type.basePath || type.recognition.property !== type.baseProperty)
    return false;
  const target = /^\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/.exec(type.recognition.value.trim())?.[1]?.trim();
  return !!filled(target) && (target === type.basePath || type.basePath.endsWith(`/${target}`));
}

export function recogniseByBase(type: NoteType): void {
  type.recognition = { property: type.baseProperty, value: `[[${type.basePath}]]` };
}
