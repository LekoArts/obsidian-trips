# Trips CLI reference

Every command runs as `obsidian vault=<name> trips:<command> [flags]` and prints one JSON object:

```json
{"apiVersion": 1, "ok": true, "command": "trips:create", "data": {}}
{"apiVersion": 1, "ok": false, "command": "trips:create", "error": {"code": "DATES_INVALID", "message": "…"}}
```

`error.report` (`{"completed": [...], "failed": "…", "untouched": [...]}`) appears only with `WRITE_FAILED`.

Flags are `key=value`; quote values with spaces (`name="Tram 28"`). A bare flag (`extend`) means true. Instead of flags, `trips:create`, `trips:assign` and `trips:reschedule` take the whole request as `json='{…}'` with the same keys; flags and `json=` can't be mixed, and unknown keys are refused.

## Contents

- [trips:status](#tripsstatus)
- [trips:kinds](#tripskinds)
- [trips:list](#tripslist)
- [trips:create](#tripscreate)
- [trips:assign](#tripsassign)
- [trips:reschedule](#tripsreschedule)

## trips:status

No flags. Whether Trips is set up, and notes that need attention.

```json
{"kinds": 6, "folders": ["Travel"], "trips": 7, "attention": [], "attentionHelp": "Resolve these in Obsidian with the command \"Review notes that need attention\"."}
```

Each `attention` item: `{"path", "label", "context", "problem"}`.

## trips:kinds

No flags. Each kind:

```json
{"id": "advanced", "label": "Advanced", "role": "trip", "dated": true, "daySections": false, "contains": ["planning", "activity"],
 "fields": [{"key": "Persons", "label": "Persons", "type": "text-list", "required": false, "default": []}]}
```

- `role`: `trip`, `entry` (day plan or stop) or `activity`.
- `contains` (trip kinds only): kinds that can belong to a trip of this kind.
- `dated`: the kind needs `start` and `end`.
- `daySections`: activities can be put on this entry's days.
- `type`: `text`, `number`, `boolean`, `date`, `url`, `text-list`, `note-link`, `note-link-list`.
- `templateMissing: true` when the kind's template can't be read; tell the user.

## trips:list

No flags. Trips with their entries and activities, plus `attention` and `attentionHelp` as in `trips:status`.

```json
{"trips": [{"path": "Travel/2026/Lisbon/Lisbon.md", "name": "Lisbon", "kind": "advanced", "start": "2026-09-10", "end": "2026-09-13",
  "entries": [{"path": "Travel/2026/Lisbon/Planning/Alfama.md", "name": "Alfama", "kind": "planning", "start": "2026-09-11", "end": "2026-09-12",
    "activities": ["Tram 28"], "days": [{"date": "2026-09-11", "activities": ["Tram 28"]}]}],
  "activities": [{"path": "Travel/2026/Lisbon/Activities/Tram 28.md", "name": "Tram 28", "kind": "activity",
    "days": [{"entry": "Alfama", "date": "2026-09-11"}]}]}],
 "attention": []}
```

An entry's `activities` are the activities that belong to it; `days` shows which are on which day, in order. An activity with `days: []` is on no day yet.

## trips:create

Creates one note.

| Flag / key | Meaning |
| --- | --- |
| `kind` | Kind id from `trips:kinds` (required) |
| `name` | Note name (required) |
| `start`, `end` | `YYYY-MM-DD`; required for dated kinds, within the trip for children |
| `trip` | The trip, by name or path; required for entries and activities, left out for trips |
| `fields` | JSON only: `{"<field key>": value}` |
| `activities` | JSON only, entries only: `[{"name": "Tram 28", "day": "2026-09-11"}]`; `day` is optional and needs `daySections` |

```bash
obsidian vault=Travel trips:create json='{"kind":"advanced","name":"Lisbon","start":"2026-09-10","end":"2026-09-13","fields":{"Persons":["Ana","Rui"]}}'
```

Reply: `{"created": "Travel/2026/Lisbon/Lisbon.md", "untouched": []}`, possibly with `warning` (the note exists; don't create it again).

## trips:assign

| Flag / key | Meaning |
| --- | --- |
| `trip` | The trip (required) |
| `activity` | An activity of that trip, by name or path (required) |
| `action` | `add`, `move` or `remove` (required) |
| `entry` | Day plan or stop to put it on (add, move) or take it off (remove) (required) |
| `day` | `YYYY-MM-DD`; required for add and move; for remove, leave out to remove it from the entry altogether |
| `from-entry` | move only: where it is now (default: `entry`) |
| `from-day` | move only, required: the day it's on now |
| `position` | add and move: place on the day, from 1; default last |

```bash
obsidian vault=Travel trips:assign trip=Lisbon action=add activity="Tram 28" entry=Alfama day=2026-09-11
obsidian vault=Travel trips:assign trip=Lisbon action=move activity="Tram 28" from-day=2026-09-11 entry=Alfama day=2026-09-12
obsidian vault=Travel trips:assign trip=Lisbon action=move activity="Tram 28" from-day=2026-09-11 entry=Alfama day=2026-09-11 position=1
obsidian vault=Travel trips:assign trip=Lisbon action=remove activity="Tram 28" entry=Alfama day=2026-09-11
```

Reply: `{"completed": ["<written paths>"], "summary": "Put Tram 28 on Fri, Sep 11."}`. A move between entries writes two notes.

## trips:reschedule

| Flag / key | Meaning |
| --- | --- |
| `trip` | The trip (required) |
| `entry` | Day plan or stop to reschedule; leave out to change the trip's own dates |
| `start`, `end` | New `YYYY-MM-DD` dates (required) |
| `extend` | Bare flag (or `"extend": true` in JSON), entries only: also grow the trip when the new dates fall outside it |

```bash
obsidian vault=Travel trips:reschedule trip=Lisbon entry=Alfama start=2026-09-12 end=2026-09-13
obsidian vault=Travel trips:reschedule trip=Lisbon entry=Alfama start=2026-09-12 end=2026-09-14 extend
obsidian vault=Travel trips:reschedule trip=Lisbon start=2026-09-09 end=2026-09-15
```

Reply: `{"completed": ["<written paths>"], "summary": "…"}`. The summary mentions activities left on days outside an entry's new dates; dates written inside note text aren't changed. A trip can only be widened.
