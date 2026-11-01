import { describe, expect, it } from 'vitest';
import { newType, presetProfile } from '../profile';
import { recognisedByBase } from '../recognition';

describe('recognisedByBase', () => {
  it('holds for every preset kind', () => {
    expect(presetProfile().types.every(recognisedByBase)).toBe(true);
  });
  it('accepts a shortest link to the Base, as written when Travel.base sits at the vault root', () => {
    const type = {
      ...newType('trip', 'trip'),
      basePath: '_templates/Bases/Travel.base',
      baseProperty: 'base',
      recognition: { property: 'base', value: '[[Travel.base]]' },
    };
    expect(recognisedByBase(type)).toBe(true);
  });
  it('is false when recognition uses another property or another Base', () => {
    const base = {
      ...newType('trip', 'trip'),
      basePath: 'Bases/Travel.base',
      baseProperty: 'base',
    };
    expect(recognisedByBase({
      ...base,
      recognition: { property: 'kind', value: 'trip' },
    })).toBe(false);
    expect(recognisedByBase({
      ...base,
      recognition: { property: 'base', value: '[[Bases/Other.base]]' },
    })).toBe(false);
    expect(recognisedByBase({
      ...base,
      recognition: { property: 'base', value: '[[ravel.base]]' },
    })).toBe(false);
    expect(recognisedByBase({
      ...base,
      basePath: '',
      recognition: { property: 'base', value: '[[Bases/Travel.base]]' },
    })).toBe(false);
  });
});
