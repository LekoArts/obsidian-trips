import { expect, it } from 'vitest';
import { getFrontMatterInfo } from './obsidian';

// What Obsidian 1.14.5's getFrontMatterInfo returned for each case: [exists, frontmatter, body].
const probed: Record<string, [string, [boolean, string, string]]> = {
  plain: [
    '---\na: 1\n---\nBody',
    [true, 'a: 1\n', 'Body'],
  ],
  crlf: [
    '---\r\na: 1\r\n---\r\nBody',
    [true, 'a: 1\r\n', 'Body'],
  ],
  unclosed: [
    '---\na: 1\nBody',
    [false, '', '---\na: 1\nBody'],
  ],
  trailing: [
    '---\na: 1\n---   \nBody',
    [false, '', '---\na: 1\n---   \nBody'],
  ],
  empty: [
    '---\n---\nBody',
    [true, '', 'Body'],
  ],
  eof: [
    '---\na: 1\n---',
    [true, 'a: 1\n', ''],
  ],
  dashes4: [
    '----\na: 1\n---\nBody',
    [false, '', '----\na: 1\n---\nBody'],
  ],
  later: [
    'Body\n---\na: 1\n---\n',
    [false, '', 'Body\n---\na: 1\n---\n'],
  ],
  leading: [
    '\n---\na: 1\n---\nB',
    [false, '', '\n---\na: 1\n---\nB'],
  ],
  dots: [
    '---\na: 1\n...\nB',
    [false, '', '---\na: 1\n...\nB'],
  ],
};
it.each(Object.entries(probed))('the test stand-in for getFrontMatterInfo matches Obsidian: %s', (_, [content, expected]) => {
  const info = getFrontMatterInfo(content);
  expect([
    info.exists,
    info.frontmatter,
    content.slice(info.contentStart),
  ]).toEqual(expected);
});
