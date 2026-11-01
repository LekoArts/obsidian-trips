// Tests run outside Obsidian. Plain libraries come from the packages Obsidian bundles; the rest are stand-ins that
// behave like Obsidian did when probed (see obsidian.test.ts).
export { default as moment } from 'moment';

/** Obsidian's interface language; tests may switch it. */
export const language = { value: 'en' };
export const getLanguage = (): string => language.value;

export function getFrontMatterInfo(content: string): { exists: boolean; frontmatter: string; from: number; to: number; contentStart: number } {
  const match = /^---\r?\n((?:[\s\S]*?\r?\n)?)---(?:\r?\n|$)/.exec(content);
  if (!match) {
    return {
      exists: false,
      frontmatter: '',
      from: 0,
      to: 0,
      contentStart: 0,
    };
  }
  const from = match[0].indexOf('\n') + 1;
  return {
    exists: true,
    frontmatter: match[1] ?? '',
    from,
    to: from + (match[1]?.length ?? 0),
    contentStart: match[0].length,
  };
}
