import { expect, it } from 'vitest';
import { emptySettings, presetProfile } from '../profile';
import { decodeSettings } from '../storage';

it('settings round trip retains one profile and explicit choices', () => {
  const settings = {
    ...emptySettings(),
    profile: presetProfile(),
    resolutions: {
      'Travel/Trip.md': { typeId: 'advanced' },
    },
  };
  expect(decodeSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
});
it.each([
  {},
  { version: 99 },
  {
    version: 1,
    profile: {
      name: 'Broken',
      scopes: ['Travel'],
      types: [null],
    },
    resolutions: {},
  },
])('rejects unsupported saved shapes without replacing them', (value) => {
  expect(() => decodeSettings(value)).toThrow('unsupported shape');
});
it('first load uses scratch setup, not preset installation', () => {
  expect(decodeSettings(null)).toEqual(emptySettings());
});
