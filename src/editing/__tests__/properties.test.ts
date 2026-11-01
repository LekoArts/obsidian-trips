import { expect, it } from 'vitest';
import { newType } from '../../config/profile';
import { parseProperties, splitNote } from '../../config/template-render';
import { editProperties } from '../properties';
import { TestVault } from '../test-vault';

it('edit preserves unknown properties and authored body including unrendered tokens', async () => {
  const io = new TestVault();
  const type = newType('trip');
  type.fields = [
    {
      key: 'Done',
      label: 'Done',
      type: 'boolean',
      required: false,
    },
  ];
  type.minimalBody = 'Never reapply me';
  const snapshot = {
    path: 'Note.md',
    content: io.note({
      unknown: { nested: 42 },
      Done: false,
    }),
  };
  io.files.set(snapshot.path, snapshot.content);
  await editProperties(io, snapshot, type, { Done: true });
  const updated = splitNote(await io.read(snapshot.path));
  expect(updated.body).toBe(splitNote(snapshot.content).body);
  expect(parseProperties(updated.yaml, io.codec)).toEqual({
    unknown: { nested: 42 },
    Done: true,
  });
});
it('wrong values and malformed frontmatter block with diagnostics, unrelated edit works with invalid dates', async () => {
  const io = new TestVault();
  const type = newType('trip');
  type.fields = [
    {
      key: 'Done',
      label: 'Done',
      type: 'boolean',
      required: false,
    },
  ];
  const snapshot = {
    path: 'Note.md',
    content: io.note({ startDate: 'invalid', endDate: [], Done: false }),
  };
  io.files.set(snapshot.path, snapshot.content);
  await expect(editProperties(io, snapshot, type, { Done: 'yes' })).rejects.toThrow('boolean');
  await expect(editProperties(io, snapshot, type, { startDate: '2026-05-20' })).rejects.toThrow('ordered');
  await editProperties(io, snapshot, type, { Done: true });
  snapshot.content = '---\ninvalid\n---\nBody';
  io.files.set(snapshot.path, snapshot.content);
  await expect(editProperties(io, snapshot, type, { Done: true })).rejects.toThrow('Malformed YAML');
});
it('explicit parent date repair accepted; stale edit rejected', async () => {
  const io = new TestVault();
  const type = newType('trip');
  const snapshot = {
    path: 'Note.md',
    content: io.note({ startDate: 'invalid', endDate: null }),
  };
  io.files.set(snapshot.path, snapshot.content);
  await editProperties(io, snapshot, type, { startDate: '2026-05-20', endDate: '2026-05-30' });
  await expect(editProperties(io, snapshot, type, { startDate: '2026-05-21' })).rejects.toThrow('changed');
});
it('an entry’s dates only change within a current, valid parent trip', async () => {
  const io = new TestVault();
  const entry = newType('plan', 'entry');
  const trip = newType('trip');
  const tripNote = {
    path: 'Trip.md',
    content: io.note({ startDate: '2026-05-01', endDate: '2026-05-10' }),
    type: trip,
  };
  io.files.set(tripNote.path, tripNote.content);
  const original = io.note({
    startDate: '2026-05-02',
    endDate: '2026-05-03',
    backlink: '[[Trip]]',
    unknown: 1,
  }, '## 2026-05-02\nProse\n');
  const snapshot = { path: 'Day.md', content: original };
  io.files.set(snapshot.path, original);
  const blocked = async (changes: Record<string, unknown>, parent?: typeof tripNote) => {
    await expect(editProperties(io, snapshot, entry, changes, parent)).rejects.toThrow();
    expect(await io.read('Day.md')).toBe(original);
    expect(io.writes).toEqual([]);
  };
  await blocked({ endDate: '2026-05-04' });
  await blocked({ endDate: '2026-05-11' }, tripNote);
  // A date that fits both versions of the trip: only the freshness check can block it.
  io.files.set('Trip.md', io.note({ startDate: '2026-05-01', endDate: '2026-05-12' }));
  await blocked({ endDate: '2026-05-04' }, tripNote);
  io.files.set('Trip.md', tripNote.content);
  await editProperties(io, snapshot, entry, { startDate: '2026-05-04', endDate: '2026-05-06' }, tripNote);
  const updated = splitNote(await io.read('Day.md'));
  expect(parseProperties(updated.yaml, io.codec)).toEqual({
    startDate: '2026-05-04',
    endDate: '2026-05-06',
    backlink: '[[Trip]]',
    unknown: 1,
  });
  expect(updated.body).toBe('## 2026-05-02\nProse\n');
});
it.each([
  [
    'missing',
    { endDate: '2026-05-10' },
  ],
  [
    'malformed',
    { startDate: '1 May', endDate: '2026-05-10' },
  ],
  [
    'reversed',
    { startDate: '2026-05-10', endDate: '2026-05-01' },
  ],
])('an entry’s dates can\'t change while its trip\'s dates are %s', async (_, tripDates) => {
  const io = new TestVault();
  const entry = newType('plan', 'entry');
  const trip = newType('trip');
  const tripNote = {
    path: 'Trip.md',
    content: io.note(tripDates),
    type: trip,
  };
  const original = io.note({ startDate: '2026-05-02', endDate: '2026-05-03', backlink: '[[Trip]]' });
  io.files.set(tripNote.path, tripNote.content);
  io.files.set('Day.md', original);
  await expect(editProperties(io, { path: 'Day.md', content: original }, entry, { endDate: '2026-05-04' }, tripNote)).rejects.toThrow();
  expect(io.writes).toEqual([]);
});
