import type { App } from 'obsidian';
import type { InstallIO } from '../config/preset-install';
import type { FileSnapshot } from '../editing/conflicts';
import type { NoteSnapshot } from '../types';
import { MarkdownView, parseYaml, stringifyYaml, TFile } from 'obsidian';
import { parseProperties, splitNote } from '../config/template-render';
import { validatePath } from '../config/validation';
import { assertBuffers, assertFresh } from '../editing/conflicts';

export interface DiscoveryIO {
  snapshots: () => NoteSnapshot[];
  paths: () => string[];
}
export class ObsidianVault implements InstallIO, DiscoveryIO {
  constructor(readonly app: App) {}
  codec = {
    parse: (text: string): unknown => parseYaml(text),
    stringify: (value: Record<string, unknown>): string => stringifyYaml(value),
  };

  buffers(path: string): string[] {
    const values: string[] = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView && leaf.view.file?.path === path)
        values.push(leaf.view.editor.getValue());
    });
    return values;
  }

  async updateProperties(expected: FileSnapshot, update: (properties: Record<string, unknown>) => void): Promise<void> {
    await assertFresh(this, expected);
    const file = this.file(expected.path);
    const { mtime, size } = file.stat;
    const original = parseProperties(splitNote(expected.content).yaml, this.codec);
    await this.app.fileManager.processFrontMatter(file, (value: unknown) => {
      assertBuffers(this.buffers(expected.path), expected.content);
      if (file.stat.mtime !== mtime || file.stat.size !== size || file.path !== expected.path)
        throw new Error('File changed outside this tab; reload it and try again');
      if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Malformed frontmatter');
      const properties: Record<string, unknown> = Object.fromEntries(Object.entries(value));
      if (JSON.stringify(properties) !== JSON.stringify(original))
        throw new Error('Properties changed outside this tab; reload it and try again');
      update(properties);
      for (const key of Object.keys(value)) Reflect.deleteProperty(value, key);
      Object.assign(value, properties);
    });
  }

  async replace(expected: FileSnapshot, content: string): Promise<void> {
    await assertFresh(this, expected);
    const file = this.file(expected.path);
    await this.app.vault.process(file, (current) => {
      assertBuffers(this.buffers(expected.path), current);
      if (current !== expected.content || file.path !== expected.path)
        throw new Error('File changed outside this tab; reload it and try again');
      return content;
    });
  }

  /**
   * Obsidian's own delete prompt, which follows the "Confirm file deletion" and "Deleted files" settings. The note is
   * checked just before the prompt; a change made while the prompt is open can't be caught, because Obsidian deletes
   * the file itself when the person confirms.
   */
  async trash(expected: FileSnapshot): Promise<boolean> {
    await assertFresh(this, expected);
    return this.app.fileManager.promptForDeletion(this.file(expected.path));
  }

  exists(path: string): boolean { return this.app.vault.getAbstractFileByPath(path) !== null; }
  paths(): string[] { return this.app.vault.getFiles().map(file => file.path); }
  /**
   * A note's `#` headings at `level`, from Obsidian's metadata cache (which skips code blocks), without reading the file.
   * Underlined (setext) headings span two lines and are left out, since day sections are only read from `#` headings.
   */
  headings(path: string, level: number): string[] {
    const file = this.app.vault.getFileByPath(path);
    return file
      ? (this.app.metadataCache.getFileCache(file)?.headings ?? []).filter(heading => heading.level === level && heading.position.start.line === heading.position.end.line).map(heading => heading.heading)
      : [];
  }

  snapshots(): NoteSnapshot[] {
    return this.app.vault.getMarkdownFiles().map((file) => {
      const cache = this.app.metadataCache.getFileCache(file);
      return { path: file.path, properties: cache?.frontmatter ?? {}, embeds: cache?.embeds?.map(embed => embed.link) ?? [] };
    });
  }

  file(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile))
      throw new TypeError(`File not found: ${path}`);
    return file;
  }

  async read(path: string): Promise<string> { return this.app.vault.read(this.file(path)); }
  async create(path: string, content: string): Promise<void> {
    if (validatePath(path).length)
      throw new Error('Invalid vault-relative destination');
    if (this.exists(path))
      throw new Error(`Destination exists: ${path}`);
    const folder = path.slice(0, path.lastIndexOf('/'));
    // createFolder makes any missing parent folders too.
    if (folder && !this.app.vault.getFolderByPath(folder))
      await this.app.vault.createFolder(folder);
    await this.app.vault.create(path, content);
  }

  /** A new note: the body is written as is, its properties by Obsidian's own frontmatter writer. */
  async createNote(path: string, content: string): Promise<void> {
    const { yaml, body } = splitNote(content);
    const properties = parseProperties(yaml, this.codec);
    await this.create(path, body);
    if (Object.keys(properties).length)
      await this.app.fileManager.processFrontMatter(this.file(path), (value: Record<string, unknown>) => Object.assign(value, properties));
  }
}
