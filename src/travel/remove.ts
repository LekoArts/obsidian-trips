import type { YamlCodec } from '../config/template-render';
import type { BatchStep } from '../editing/batch';
import type { FileSnapshot } from '../editing/conflicts';
import type { NoteType } from '../types';
import { parseProperties, splitNote } from '../config/template-render';
import { filled, isNoteLink } from '../config/validation';

export const BASE_FILTER_CAVEAT = 'Detachment removes only the parent property. A Base using other links may still show this note; no prose links, children, activities, or attachments are removed.';
export function relationshipPreview(before: FileSnapshot, type: NoteType, codec: YamlCodec, parentPath?: string): BatchStep {
  if (type.role === 'trip')
    throw new Error('A trip cannot be detached as a child');
  const value = parseProperties(splitNote(before.content).yaml, codec)[type.mappings.parent];
  if (value != null && value !== '' && !isNoteLink(value))
    throw new Error('Parent property must be a note link');
  if (filled(parentPath) && /[[\]|#\r\n]/.test(parentPath))
    throw new Error('Parent target cannot be represented safely');
  return {
    before,
    kind: 'properties',
    changes: filled(parentPath)
      ? { [type.mappings.parent]: `[[${parentPath}]]` }
      : {},
    remove: filled(parentPath)
      ? []
      : [type.mappings.parent],
    summary: `${filled(parentPath)
      ? `Attach to ${parentPath}.`
      : 'Detach from itinerary.'} ${BASE_FILTER_CAVEAT}`,
  };
}
export function trashPreview(before: FileSnapshot): BatchStep {
  return { before, kind: 'trash', summary: `Trash only ${before.path}. Children, activities and attachments remain. Links to this note may become unresolved. Confirm separately; this is not detachment.` };
}
