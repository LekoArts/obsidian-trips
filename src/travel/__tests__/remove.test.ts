import { expect, it } from 'vitest';
import { newType } from '../../config/profile';
import { parseProperties, splitNote } from '../../config/template-render';
import { applyBatch, batchPlan } from '../../editing/batch';
import { TestVault } from '../../editing/test-vault';
import { BASE_FILTER_CAVEAT, relationshipPreview, trashPreview } from '../remove';

it('detach retains the file, body, unknown properties and activity membership; reattach restores relation', async () => {
  const io = new TestVault();
  const type = newType('child', 'entry');
  const before = {
    path: 'Child',
    content: io.note({
      backlink: '[[Trip]]',
      activities: ['[[A]]'],
      unknown: 7,
    }, 'Prose [[Trip]]'),
  };
  io.files.set(before.path, before.content);
  const step = relationshipPreview(before, type, io.codec);
  expect(step.summary).toContain(BASE_FILTER_CAVEAT);
  await applyBatch(io, batchPlan([step]));
  const detached = await io.read('Child');
  expect(splitNote(detached).body).toBe('Prose [[Trip]]');
  expect(parseProperties(splitNote(detached).yaml, io.codec)).toEqual({
    activities: ['[[A]]'],
    unknown: 7,
  });
  await applyBatch(io, batchPlan([
    relationshipPreview({ path: 'Child', content: detached }, type, io.codec, 'Trip.md'),
  ]));
  expect(parseProperties(splitNote(await io.read('Child')).yaml, io.codec).backlink).toBe('[[Trip.md]]');
});
it('trash is separate preview and confirmation, never cascading', async () => {
  const io = new TestVault();
  for (const path of [
    'Trip',
    'Child',
    'Activity',
    'Attachment',
  ]) io.files.set(path, io.note({}));
  const step = trashPreview({ path: 'Trip', content: await io.read('Trip') });
  expect(io.files.size).toBe(4);
  await applyBatch(io, batchPlan([step]));
  expect([
    ...io.files.keys(),
  ]).toEqual(['Child', 'Activity', 'Attachment']);
});
