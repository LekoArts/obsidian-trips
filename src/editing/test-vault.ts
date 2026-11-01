import type { FileSnapshot } from './conflicts';
import { parseProperties, splitNote } from '../config/template-render';
import { headings } from '../travel/day-sections';
import { assertFresh } from './conflicts';

/** JSON is a YAML subset. Fixtures exercise the IO contract, not Obsidian's YAML parser. */
export class TestVault {
  files = new Map<string, string>();
  editors = new Map<string, string[]>();
  writes: string[] = [];
  failPath?: string;
  codec = {
    parse: (text: string): unknown => JSON.parse(text),
    stringify: (value: Record<string, unknown>) => JSON.stringify(value),
  };

  exists(path: string): boolean { return this.files.has(path); }
  /** Stands in for Obsidian's metadata cache, which also skips headings in code blocks and comments and never throws. */
  headings(path: string, level: number): string[] {
    const content = this.files.get(path);
    try {
      return content === undefined
        ? []
        : headings(splitNote(content).body).filter(heading => heading.level === level).map(heading => heading.text);
    }
    catch {
      return [];
    }
  }

  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    return content === undefined
      ? Promise.reject(new Error('Missing file'))
      : Promise.resolve(content);
  }

  buffers(path: string): string[] { return this.editors.get(path) ?? []; }
  async create(path: string, content: string): Promise<void> {
    if (this.exists(path) || this.failPath === path)
      return Promise.reject(new Error('Write failed'));
    this.files.set(path, content);
    this.writes.push(path);
    return Promise.resolve();
  }

  async createNote(path: string, content: string): Promise<void> { return this.create(path, content); }

  async updateProperties(expected: FileSnapshot, update: (properties: Record<string, unknown>) => void): Promise<void> {
    await assertFresh(this, expected);
    if (this.failPath === expected.path)
      throw new Error('Write failed');
    const parts = splitNote(expected.content);
    const properties = parseProperties(parts.yaml, this.codec);
    update(properties);
    this.files.set(expected.path, this.note(properties, parts.body));
    this.writes.push(expected.path);
  }

  async replace(expected: FileSnapshot, content: string): Promise<void> {
    await assertFresh(this, expected);
    if (this.failPath === expected.path)
      throw new Error('Write failed');
    this.files.set(expected.path, content);
    this.writes.push(expected.path);
  }

  /** What the delete prompt answers. */
  confirmDelete = true;
  async trash(expected: FileSnapshot): Promise<boolean> {
    await assertFresh(this, expected);
    if (this.failPath === expected.path)
      throw new Error('Trash failed');
    if (!this.confirmDelete)
      return false;
    this.files.delete(expected.path);
    this.writes.push(expected.path);
    return true;
  }

  note(properties: Record<string, unknown>, body = 'Authored prose {{date}}\n'): string { return `---\n${JSON.stringify(properties)}\n---\n${body}`; }
}
