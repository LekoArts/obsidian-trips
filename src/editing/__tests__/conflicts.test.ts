import { expect, it } from 'vitest';
import { assertFresh, capture } from '../conflicts';
import { TestVault } from '../test-vault';

it('changed disk, missing file, or any dirty split-pane buffer stops save', async () => {
  const io = new TestVault();
  io.files.set('Note.md', 'Original');
  const snapshot = await capture(io, 'Note.md');
  io.editors.set('Note.md', ['Original', 'Unsaved']);
  await expect(assertFresh(io, snapshot)).rejects.toThrow('unsaved');
  io.editors.clear();
  io.files.set('Note.md', 'Changed');
  await expect(assertFresh(io, snapshot)).rejects.toThrow('File changed');
  io.files.delete('Note.md');
  await expect(assertFresh(io, snapshot)).rejects.toThrow('disappeared');
});
it('refresh captures current content only when buffers are saved', async () => {
  const io = new TestVault();
  io.files.set('Note.md', 'New');
  io.editors.set('Note.md', ['New']);
  await expect(capture(io, 'Note.md')).resolves.toEqual({ path: 'Note.md', content: 'New' });
});
it('an editor showing a CRLF file with plain line breaks is saved; an edit in it is not', async () => {
  const io = new TestVault();
  io.files.set('Note.md', 'a\r\nb\r\n');
  io.editors.set('Note.md', ['a\nb\n']);
  await expect(capture(io, 'Note.md')).resolves.toEqual({ path: 'Note.md', content: 'a\r\nb\r\n' });
  io.editors.set('Note.md', ['a\nc\n']);
  await expect(capture(io, 'Note.md')).rejects.toThrow('unsaved');
});
