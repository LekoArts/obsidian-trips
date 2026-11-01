---
name: trips
description: Plan trips in an Obsidian vault that uses the Trips plugin, through its trips:* Obsidian CLI commands. Use this whenever the user wants to create a trip, day plan, stop or activity in Obsidian, put activities on days, move or reorder them, take them off a day, or change the dates of a trip, day plan or stop — even if they only say "plan my trip to Lisbon in my vault" or "move the museum to Tuesday" without naming the plugin.
---

# Trips

The Trips plugin keeps travel plans as ordinary Markdown notes: a trip note, child notes for day plans or stops (both called *entries*), and activity notes. Which kinds exist, their properties, folders and templates come from the user's own Trips setup, so notes written by hand or by generic note commands come out subtly wrong (missing properties, wrong links, wrong folder). The `trips:*` commands write notes exactly as Trips' own creation form and trip tab do, so use only them to write travel notes.

## Before anything else

1. Run `obsidian version`. If the command is missing or fails, stop and tell the user this needs the Obsidian CLI installed, with Obsidian (1.13.1 or later) running and the vault open.
2. Find the vault. If the user named it, pass `vault=<name>` as the first argument of every command. Otherwise run `obsidian vaults` and ask which one if there is more than one.
3. Run `obsidian vault=<name> trips:status`. If `ok` is `false` with `NOT_SET_UP`, stop and tell the user to set up Trips in Obsidian (Settings → Trips) — don't try to set it up yourself, and don't fall back to writing notes another way.

## Reading replies

Every command prints one JSON object. The CLI's exit code is always 0, even on failure, so always read the `ok` field:

- `{"ok": true, "data": {…}}` — it worked.
- `{"ok": false, "error": {"code": "…", "message": "…"}}` — nothing was written unless `error.report.completed` lists files. The message says what to do next.

If the output isn't JSON (for example `Command "trips:list" not found`), the Trips plugin is missing, disabled or too old; tell the user.

## Creating notes

Workflow: `trips:status` → `trips:kinds` → `trips:list` → `trips:create` → read the reply.

1. `trips:kinds` lists every kind with its `id`, `role` (`trip`, `entry` or `activity`), whether it needs dates (`dated`), whether activities can go on its days (`daySections`), and its `fields` (key, type, default). A trip kind's `contains` lists the kinds that can belong to it — pick a trip kind that contains what the user wants (for example a trip with day plans and activities).
2. `trips:list` shows existing trips. Check the trip doesn't already exist before creating it, and use names or paths exactly as shown there.
3. Create one note per call, parent first: the trip, then activities, then entries that list those activities.

```bash
obsidian vault=Travel trips:create kind=advanced name=Lisbon start=2026-09-10 end=2026-09-13
obsidian vault=Travel trips:create kind=activity name="Tram 28" trip="Travel/2026/Lisbon/Lisbon.md"
obsidian vault=Travel trips:create json='{"kind":"planning","name":"Alfama","trip":"Travel/2026/Lisbon/Lisbon.md","start":"2026-09-11","end":"2026-09-12","activities":[{"name":"Tram 28","day":"2026-09-11"}]}'
```

Use `json='…'` (single quotes around the whole object) whenever the request has `fields` or `activities`; flags can't carry them. Flags and `json=` can't be mixed. The reply's `data.created` is the new note's path — use that path for the `trip` of later notes.

Field values follow the field's type from `trips:kinds`: text as a string, `number` as a number, `boolean` as `true`/`false`, `*-list` as a list of strings, `date` as `YYYY-MM-DD`. Leave a field out to get its default; pass `""`, `[]` or `null` to leave it empty. Only pass fields the user asked for.

## Changing plans

Workflow: `trips:list` → `trips:assign` or `trips:reschedule` → `trips:list` to confirm.

There is no Undo from the CLI, so read `trips:list` first to see where things are, change one thing at a time, and read `trips:list` again to confirm the result before telling the user it's done.

- **Put an activity on a day:** `trips:assign action=add trip=… activity=… entry=… day=YYYY-MM-DD [position=N]`. The activity note must already exist in the trip (create it first), the day must be within the entry and the trip, and the entry's kind must have `daySections: true`.
- **Move it** to another day, in the same or another entry: `action=move … from-day=YYYY-MM-DD [from-entry=…] entry=… day=…`. `from-entry` defaults to `entry`. Moving within the same day with a `position` reorders it.
- **Take it off:** `action=remove … entry=… day=…` takes it off that day only; without `day` it removes the activity from the entry altogether. The activity note itself always stays.
- **Reschedule an entry:** `trips:reschedule trip=… entry=… start=… end=…`. If the new dates fall outside the trip you get `OUTSIDE_TRIP`; ask the user before retrying with the bare `extend` flag (which grows the trip too), unless they already asked to grow the trip. The reply's `summary` says when activities are left on days outside the new dates — tell the user.
- **Change the trip's dates:** `trips:reschedule trip=… start=… end=…` without `entry`. Trips can only be widened from the CLI; entries keep their dates.

`position` counts from 1 (first on the day); leave it out to put the activity last. See [references/commands.md](references/commands.md) for every flag, the JSON form and reply shapes.

## Rules

- Dates are `YYYY-MM-DD`. Child dates must lie within the trip's dates.
- Use kinds and field keys from `trips:kinds`, and names or paths from `trips:list`. When a name is ambiguous, the error lists paths; use the one the user means, or ask.
- Never write or edit travel notes by hand, with `obsidian create`, `append`, `prepend`, `property:set`, `move`, `rename`, `delete` or similar commands, or by editing files on disk. Don't stage request files in the vault either; pass requests inline.
- Notes the vault already has are the user's; only change what they asked for.

## What stays in Obsidian

The CLI can't edit properties of existing notes, attach or detach notes from a trip, delete notes, undo changes, resolve notes that need attention, or change the Trips setup. When the user wants one of these, tell them to do it in Obsidian (the trip tab, "Edit trip properties…", or the command "Review notes that need attention").

## Notes that need attention

`trips:status` and `trips:list` return `attention`: notes Trips can't match to one kind or one trip. You can't fix these through the CLI. Mention them to the user and point them to the command "Review notes that need attention" in Obsidian, especially when one of them is a note the user asked you to work with.

## Errors and what to do

| Code | What to do |
| --- | --- |
| `NOT_SET_UP` | Stop; the user must set up Trips in Obsidian (or fix the setup problems in the message). |
| `INVALID_INPUT` | Fix the flag or JSON key the message names; check `references/commands.md`. |
| `UNKNOWN_KIND` | Use a kind id from `trips:kinds` that the trip's kind `contains`. |
| `PARENT_NOT_FOUND`, `NOTE_NOT_FOUND` | Check `trips:list`. If you created it a moment ago, wait a few seconds and retry once. |
| `ACTIVITY_NOT_FOUND` | Create the activity first with `trips:create`. If you just created it, wait a few seconds and retry once. |
| `PARENT_AMBIGUOUS`, `NOTE_AMBIGUOUS`, `ACTIVITY_AMBIGUOUS` | Retry with the path the user means from the message; ask if unclear. |
| `DATES_INVALID` | Fix the dates: valid `YYYY-MM-DD`, end not before start, within the trip. Widening the trip first needs the user's go-ahead. |
| `DESTINATION_EXISTS` | A note with that name already exists. Use it, or ask the user for another name. |
| `DAY_OUTSIDE_ENTRY` | Pick a day inside both the entry and the trip (the message gives the range), or reschedule first if the user wants. |
| `NOT_ON_DAY` | The activity isn't where you said. Read `trips:list` and use its actual entry and day. |
| `OUTSIDE_TRIP` | Ask the user before retrying with `extend`, unless they asked to grow the trip. |
| `CHANGED` | Something changed while the command ran; nothing was written. Read `trips:list` and retry once. |
| `CANNOT_EDIT` | Trips can't safely edit that note (for example an unclosed comment or duplicate headings). Tell the user to fix the note in Obsidian. |
| `WRITE_FAILED` | Don't retry blindly. For `trips:create`, the note in the message may exist half-written; tell the user. For edits, `error.report.completed` lists files that were written (`[]` means none) and `error.report.failed` the one that failed; read `trips:list`, then tell the user what changed. |
| `INTERNAL` | Report the message to the user; don't retry in a loop. |

A reply with `ok: true` and a `warning` means the note was written but something minor failed. The note exists; don't create it again, and pass the warning on to the user.
