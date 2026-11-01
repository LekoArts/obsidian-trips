import { expect, it } from 'vitest';
import { containedKinds, presetProfile } from '../profile';

it('trip kinds contain the kinds whose Bases their template embeds', () => {
  const types = presetProfile().types;
  expect(containedKinds('![[_templates/Bases/Planning.base]]\n![[Activities.base#Table]]', types).map(type => type.id)).toEqual(['planning', 'activity']);
  expect(containedKinds('Just prose', types)).toEqual([]);
});
it('trip contents: explicit list wins, older profiles fall back to embedded Bases', async () => {
  const { presetProfile: preset, tripContents: contents } = await import('../profile');
  const types = preset().types;
  const kind = (id: string) => types.find(type => type.id === id)!;
  expect(contents(kind('simple'), types).map(type => type.id)).toEqual([]);
  expect(contents(kind('advanced'), types).map(type => type.id)).toEqual(['planning', 'activity']);
  expect(contents(kind('roadtrip'), types).map(type => type.id)).toEqual(['stop']);
  const legacy = {
    ...kind('advanced'),
    contains: undefined,
  };
  expect(contents(legacy, types, '![[Planning.base]]').map(type => type.id)).toEqual(['planning']);
  expect(contents(legacy, types, 'no embeds', '![[Activities.base]]').map(type => type.id)).toEqual(['activity']);
});
