import { expect, it } from 'vitest';
import { emptySettings, newType, presetProfile, validateProfile } from '../profile';
import { validateField } from '../validation';

it('preset and scratch use the same profile model', () => {
  expect(validateProfile(presetProfile())).toEqual([]);
  expect(validateProfile(emptySettings().profile)).toEqual([]);
});
function messages(change: (type: ReturnType<typeof newType>) => void) {
  const type = newType('custom', 'entry');
  change(type);
  return validateProfile({
    name: 'Custom',
    scopes: ['Trips'],
    types: [type],
  }).map(d => d.message);
}
it('missing and duplicate property mappings are diagnosed', () => {
  expect(messages((type) => {
    type.mappings.start = '';
  })).toContain('Dated types need start and end mappings');
  expect(messages((type) => {
    type.mappings.parent = '';
  })).toContain('Child types need a parent mapping');
  expect(messages((type) => {
    type.mappings.end = type.mappings.start;
  })).toContain('Semantic mappings must use distinct properties');
});
it('validates wrong-typed defaults and required fields', () => {
  expect(validateField({
    key: 'x',
    label: 'X',
    type: 'boolean',
    required: false,
  }, 'true')).toContain('boolean');
  expect(validateField({
    key: 'x',
    label: 'X',
    type: 'number',
    required: true,
  }, null)).toContain('required');
});
it.each(['text-list', 'note-link-list'] as const)('allows empty optional %s', (type) => {
  for (const value of [[], null, undefined]) {
    expect(validateField({
      key: 'x',
      label: 'X',
      type,
      required: false,
    }, value)).toBeUndefined();
  }
});
it('requires selected template and Base to exist', () => {
  const profile = presetProfile();
  expect(validateProfile(profile, {
    exists: () => false,
    template: () => undefined,
  }).some(d => d.message.includes('not found'))).toBe(true);
});
it('a date, parent or field can\'t use the recognition or Base link property, which creation also writes', () => {
  const reserved = 'Property names must differ from the recognition and Base link properties';
  expect(messages((type) => {
    type.mappings.start = type.recognition.property;
  })).toContain(reserved);
  expect(messages((type) => {
    type.basePath = 'Bases/Plan.base';
    type.mappings.parent = type.baseProperty;
  })).toContain(reserved);
  expect(messages((type) => {
    type.fields = [
      {
        key: type.recognition.property,
        label: 'Kind',
        type: 'text',
        required: false,
      },
    ];
  })).toContain('Duplicate or protected field: kind');
  expect(messages((type) => {
    type.basePath = 'Bases/Plan.base';
    type.recognition.property = type.baseProperty;
    type.recognition.value = '[[Other.base]]';
  }))
    .toContain('Recognition and Base link use the same property with different values');
  // Recognised by its Base link: the same property with the same value is fine.
  expect(messages((type) => {
    type.basePath = 'Bases/Plan.base';
    type.recognition.property = type.baseProperty;
    type.recognition.value = '[[Bases/Plan.base]]';
  })).toEqual([]);
});
it('fields, headings and day sections that would write broken notes are diagnosed', () => {
  expect(messages((type) => {
    type.fields = [
      {
        key: 'Done',
        label: 'Done',
        type: 'boolean',
        required: false,
      },
      {
        key: 'Done',
        label: 'Again',
        type: 'text',
        required: false,
      },
    ];
  })).toContain('Duplicate or protected field: Done');
  expect(messages((type) => {
    type.fields = [
      {
        key: 'Done',
        label: 'Done',
        type: 'boolean',
        required: false,
        defaultValue: 'yes',
      },
    ];
  }).join()).toContain('boolean');
  expect(messages((type) => {
    type.days.activityLevel = type.days.headingLevel;
  })).toContain('Choose valid nested day and activity headings');
  expect(messages((type) => {
    type.days.enabled = true;
    type.mappings.activities = '';
  })).toContain('Daily sections need dates and an activity mapping');
});
