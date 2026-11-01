import { expect, it } from 'vitest';
import { newType, presetProfile } from '../profile';
import { differsFromShared, setProperty, sharedFollowers, sharedValue } from '../shared-properties';

it('preset kinds share one name per property', () => {
  const types = presetProfile().types;
  expect(sharedValue(types, 'start')).toBe('startDate');
  expect(sharedValue(types, 'parent')).toBe('backlink');
  expect(sharedValue(types, 'base')).toBe('base');
  expect(types.some(type => ([
    'start',
    'end',
    'parent',
    'activities',
    'base',
  ] as const).some(key => differsFromShared(type, types, key)))).toBe(false);
});

function rename(types: ReturnType<typeof presetProfile>['types'], key: Parameters<typeof sharedFollowers>[1], value: string) {
  for (const type of sharedFollowers(types, key)) setProperty(type, key, value);
}
it('renaming a shared property updates matching kinds and keeps per-kind overrides', () => {
  const types = presetProfile().types;
  types.find(type => type.id === 'stop')!.mappings.start = 'from';
  rename(types, 'start', 'begins');
  const starts = Object.fromEntries(types.filter(type => type.dated).map(type => [type.id, type.mappings.start]));
  expect(starts.stop).toBe('from');
  expect(Object.entries(starts).filter(([id]) => id !== 'stop').every(([, start]) => start === 'begins')).toBe(true);
  expect(differsFromShared(types.find(type => type.id === 'stop')!, types, 'start')).toBe(true);
  // Trips have no parent link, so renaming it leaves them blank.
  rename(types, 'parent', 'trip');
  expect(types.filter(type => type.role === 'trip').every(type => type.mappings.parent === '')).toBe(true);
  expect(types.filter(type => type.role !== 'trip').every(type => type.mappings.parent === 'trip')).toBe(true);
});

it('clearing and retyping a shared name never captures a kind with its own name', () => {
  const types = presetProfile().types;
  const stop = types.find(type => type.id === 'stop')!;
  stop.mappings.start = 'from';
  const followers = sharedFollowers(types, 'start');
  for (const value of ['', 'b', 'be', 'begins']) {
    for (const type of followers) setProperty(type, 'start', value);
  }
  expect(stop.mappings.start).toBe('from');
  expect(sharedValue(types, 'start')).toBe('begins');
});

it('custom names are read back unchanged and kinds without a Base are ignored', () => {
  const journey = {
    ...newType('journey'),
    basePath: 'Setup/Journeys.base',
    baseProperty: 'journeyBase',
    mappings: {
      start: 'begins',
      end: 'finishes',
      parent: '',
      activities: 'Activities',
    },
  };
  const visit = {
    ...newType('visit', 'entry'),
    mappings: {
      start: 'begins',
      end: 'finishes',
      parent: 'journey',
      activities: 'visits',
    },
  };
  const types = [journey, visit];
  expect(sharedValue(types, 'start')).toBe('begins');
  expect(sharedValue(types, 'parent')).toBe('journey');
  expect(sharedValue(types, 'base')).toBe('journeyBase');
  expect(differsFromShared(visit, types, 'base')).toBe(false);
  // A tie keeps the first kind's name and marks the other as its own.
  expect(sharedValue(types, 'activities')).toBe('Activities');
  expect(differsFromShared(visit, types, 'activities')).toBe(true);
});
