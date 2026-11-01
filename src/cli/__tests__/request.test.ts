import type { FieldDefinition } from '../../types';
import { expect, it } from 'vitest';
import { answer, CliError, fail, ok } from '../reply';
import { createRequest, fieldStrings } from '../request';

function field(key: string, type: FieldDefinition['type']): FieldDefinition {
  return {
    key,
    label: key,
    type,
    required: false,
  };
}
function code(run: () => unknown) {
  try {
    run();
  }
  catch (error) {
    return error instanceof CliError
      ? `${error.code}: ${error.message}`
      : String(error);
  }
  return 'no error';
}

it('replies with a versioned JSON envelope and a report only when files may have been written', async () => {
  expect(JSON.parse(ok('trips:status', { kinds: 6 }))).toEqual({
    apiVersion: 1,
    ok: true,
    command: 'trips:status',
    data: { kinds: 6 },
  });
  expect(JSON.parse(fail('trips:create', 'UNKNOWN_KIND', 'Use advanced'))).toEqual({
    apiVersion: 1,
    ok: false,
    command: 'trips:create',
    error: { code: 'UNKNOWN_KIND', message: 'Use advanced' },
  });
  expect(JSON.parse(fail('trips:assign', 'WRITE_FAILED', 'Write failed', {
    completed: ['a.md'],
    failed: 'b.md',
    untouched: [],
  }))).toEqual({
    apiVersion: 1,
    ok: false,
    command: 'trips:assign',
    error: {
      code: 'WRITE_FAILED',
      message: 'Write failed',
      report: {
        completed: ['a.md'],
        failed: 'b.md',
        untouched: [],
      },
    },
  });
  expect(JSON.parse(await answer('trips:list', () => {
    throw new Error('boom');
  }))).toEqual({
    apiVersion: 1,
    ok: false,
    command: 'trips:list',
    error: { code: 'INTERNAL', message: 'boom' },
  });
  expect(JSON.parse(await answer('trips:list', async () => Promise.reject(new CliError('NOT_SET_UP', 'Set it up'))))).toEqual({
    apiVersion: 1,
    ok: false,
    command: 'trips:list',
    error: { code: 'NOT_SET_UP', message: 'Set it up' },
  });
});

it('reads a create request from flags or from one json flag, never both', () => {
  expect(createRequest({
    kind: 'planning',
    name: 'Alfama',
    trip: 'Lisbon',
    start: '2026-09-11',
    end: '2026-09-12',
  })).toEqual({
    kind: 'planning',
    name: 'Alfama',
    trip: 'Lisbon',
    start: '2026-09-11',
    end: '2026-09-12',
    fields: {},
    activities: [],
  });
  expect(createRequest({ json: '{"kind":"planning","name":"Alfama","activities":[{"name":"Tram 28","day":"2026-09-11"}],"fields":{"Done":true}}' })).toEqual({
    kind: 'planning',
    name: 'Alfama',
    start: undefined,
    end: undefined,
    trip: undefined,
    fields: { Done: true },
    activities: [
      { name: 'Tram 28', day: '2026-09-11' },
    ],
  });
  expect(code(() => createRequest({ kind: 'planning', json: '{}' }))).toBe('INVALID_INPUT: Pass either flags or json=, not both');
  expect(code(() => createRequest({ kind: 'planning', name: 'A', input: 'CLI/a.json' }))).toBe('INVALID_INPUT: Unknown flag input; use kind, name, start, end, trip, json');
  expect(code(() => createRequest({ json: '{"kind":"planning","name":"A","colour":"red"}' }))).toBe('INVALID_INPUT: Unknown key colour; use kind, name, start, end, trip, fields, activities');
  expect(code(() => createRequest({ json: '{kind:planning}' }))).toBe('INVALID_INPUT: json= is not valid JSON; wrap it in single quotes');
  expect(code(() => createRequest({ json: '["planning"]' }))).toBe('INVALID_INPUT: json= must hold a JSON object');
  expect(code(() => createRequest({ json: '{"name":"A"}' }))).toBe('INVALID_INPUT: kind is required');
  expect(code(() => createRequest({ json: '{"kind":"planning","name":3}' }))).toBe('INVALID_INPUT: name must be text');
  expect(code(() => createRequest({ json: '{"kind":"planning","name":"A","fields":[]}' }))).toBe('INVALID_INPUT: fields must be an object of field key → value');
  expect(code(() => createRequest({ json: '{"kind":"planning","name":"A","activities":[{"name":"T","at":"x"}]}' }))).toBe('INVALID_INPUT: Unknown activity key at; use name, day');
});

it('turns field values into the text the form holds, leaving omitted fields out so they get their defaults', () => {
  const fields = [
    field('Notes', 'text'),
    field('Cost', 'number'),
    field('Done', 'boolean'),
    field('Tags', 'text-list'),
    field('Places', 'note-link-list'),
    field('Left', 'text'),
  ];
  expect(fieldStrings(fields, {
    Notes: null,
    Cost: 12.5,
    Done: false,
    Tags: ['a', 'b'],
    Places: [],
  })).toEqual({
    Notes: '',
    Cost: '12.5',
    Done: 'false',
    Tags: 'a\nb',
    Places: '',
  });
  expect(fieldStrings(fields, { Cost: '7', Tags: 'a' })).toEqual({ Cost: '7', Tags: 'a' });
  expect(code(() => fieldStrings(fields, { Price: 3 }))).toBe('INVALID_INPUT: Unknown field Price; use Notes, Cost, Done, Tags, Places, Left');
  expect(code(() => fieldStrings([], { Price: 3 }))).toBe('INVALID_INPUT: Unknown field Price; there are none');
  expect(code(() => fieldStrings(fields, { Notes: 3 }))).toBe('INVALID_INPUT: Notes must be text');
  expect(code(() => fieldStrings(fields, { Cost: true }))).toBe('INVALID_INPUT: Cost must be number');
  expect(code(() => fieldStrings(fields, {
    Notes: ['a'],
  }))).toBe('INVALID_INPUT: Notes must be text');
  expect(code(() => fieldStrings(fields, {
    Tags: ['a\nb'],
  }))).toBe('INVALID_INPUT: Tags must be text-list');
  expect(code(() => fieldStrings(fields, {
    Tags: { a: 1 },
  }))).toBe('INVALID_INPUT: Tags must be text-list');
});
