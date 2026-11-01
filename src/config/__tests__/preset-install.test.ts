import { expect, it } from 'vitest';
import { bundledPreset, installPreview, previewInstall, validateTemplateLinks } from '../preset-install';

function fixture(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    exists: (path: string) => files.has(path),
    read: async (path: string) => Promise.resolve(files.get(path) ?? ''),
    create: async (path: string, content: string) => {
      if (files.has(path))
        throw new Error('collision');
      files.set(path, content);
      return Promise.resolve();
    },
  };
}
it('previews all files without writes and installs at default destinations', async () => {
  const io = fixture();
  const preview = await previewInstall(io);
  expect(io.files.size).toBe(0);
  expect(preview.every(f => f.path.startsWith('_templates/') && f.action === 'create')).toBe(true);
  expect((await installPreview(io, preview)).failed).toBeUndefined();
  for (const file of bundledPreset()) expect(io.files.get(file.path)).toBe(file.content);
  for (const file of bundledPreset()) {
    expect(validateTemplateLinks(file.content, target => io.exists(target)
      ? target
      : undefined)).toEqual([]);
  }
});
it('reuses customized existing templates byte-for-byte', async () => {
  const io = fixture({ '_templates/Planning.md': 'authored {{date}} prose\n' });
  const preview = await previewInstall(io);
  expect(preview.find(f => f.path === '_templates/Planning.md')).toMatchObject({ action: 'reuse', different: true });
  await installPreview(io, preview);
  expect(io.files.get('_templates/Planning.md')).toBe('authored {{date}} prose\n');
});
it('reports partial failure rather than overwriting a post-preview collision', async () => {
  const io = fixture();
  const preview = await previewInstall(io);
  const second = preview[1];
  if (!second)
    throw new Error('fixture');
  io.files.set(second.path, 'external change');
  const report = await installPreview(io, preview);
  expect(report.completed).toHaveLength(1);
  expect(report.failed).toContain(second.path);
  expect(report.untouched.length).toBe(preview.length - 2);
  expect(io.files.get(second.path)).toBe('external change');
});
it('template links are checked against the chosen files', () => {
  const template = 'My prose ![[Custom/Trips.base]]\n';
  expect(validateTemplateLinks(template, target => target === 'Custom/Trips.base'
    ? target
    : undefined)).toEqual([]);
  expect(validateTemplateLinks(template, () => undefined)).toHaveLength(1);
});
it('new date-bearing templates distinguish start and end dates', () => {
  const templates = bundledPreset().filter(f => f.path.endsWith('.md') && f.content.includes('startDate:'));
  expect(templates).toHaveLength(5);
  for (const file of templates) {
    expect(file.content).toContain('{{start_date}}');
    expect(file.content).toContain('{{end_date}}');
    expect(file.content).not.toContain('{{date');
  }
});
