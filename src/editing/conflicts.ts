export interface FileSnapshot { path: string; content: string }
export interface ReadIO {
  exists: (path: string) => boolean;
  read: (path: string) => Promise<string>;
  buffers: (path: string) => string[];
}
/** An open editor matches the file if its text is the file's; the editor shows CRLF files with plain line breaks. */
export function assertBuffers(contents: string[], disk: string): void {
  const lf = disk.replace(/\r\n/g, '\n');
  if (contents.some(content => content !== disk && content !== lf))
    throw new Error('An open editor has unsaved changes. Save the note, then try again.');
}
export async function capture(io: ReadIO, path: string): Promise<FileSnapshot> {
  if (!io.exists(path))
    throw new Error(`File disappeared: ${path}`);
  const content = await io.read(path);
  assertBuffers(io.buffers(path), content);
  return { path, content };
}
export async function assertFresh(io: ReadIO, expected: FileSnapshot): Promise<void> {
  const current = await capture(io, expected.path);
  if (current.content !== expected.content)
    throw new Error(`File changed: ${expected.path}. Nothing was saved; reload it and try again.`);
}
