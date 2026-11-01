# Trips: specification

Condensed, current design record for the Obsidian plugin **Trips** (`id: trips`). Where a decision changed during implementation, only the current rule is stated, with a short note on what it replaced and why. The README is the user-facing description; this file is the why and the rules.

## 1. Product

An **authoring** plugin for travel notes. It removes the plumbing of a template-based travel workflow: picking the right template and folder, filling frontmatter dates, wiring the parent link, writing day headings, and keeping dates and day plans consistent when plans change.

- **Obsidian is the viewer and the freeform editor.** The plugin never becomes the only place a fact lives. Trip notes, Bases and links must read and work identically with the plugin disabled.
- **Files are the source of truth.** Frontmatter holds structure and relationships; configured body sections hold per-day activity placement; Bases are optional views. Plugin settings hold configuration only, never trip content, order or assignments.
- **Editing happens on desktop**, typically an evening session with several changes in a row and the trip note open beside the trip tab. **On the phone the user is in plain Obsidian** (the trip note's Base table shows the itinerary). The plugin must load and work at phone width and keep every action reachable by tap or menu, but it isn't optimised for mobile editing.
- **Local only:** no network requests, telemetry, remote templates or booking integrations. A banner URL is stored as text, never fetched.

Prior art: Roamvault (standalone web app by the same author) created trips from templates and assigned activities to days. Carried over: template-based creation, automatic parent links and destinations, dates bounded by the trip, day-section generation, per-day activity assignment, files as truth. Deliberately not carried over: its browser vault picker, its read-only trip views, fixed template names/fields/classification, permissive day-heading parsing that picks one of several duplicates, and whole-body rewriting.

## 2. Vocabulary

- **Trip**: the parent note. A trip kind with nothing in *Contains* is a single note (e.g. Simple).
- **Itinerary entry** (dated entry): one note covering an inclusive date range, e.g. a day plan (*Planning*) or a roadtrip *Stop*. A day inside a multi-day entry is not a file.
- **Activity**: a note collected for a trip, listed in an entry's activity-list property and optionally placed on specific days of that entry.
- **Kind** (code: `NoteType`): a configured note type with role `trip`, `entry` or `activity`.
- **Profile**: the one active configuration (kinds, scopes, shared property names). A **preset** is a starting profile plus template and Base files; once installed it is ordinary editable configuration.
- **Changeover day**: a day where one entry ends and the next starts (arrival and departure both happen). Normal, not an overlap.

## 3. What users come to do (drives all UI)

| Job | Frequency / context | UI consequence |
|---|---|---|
| Set up for my vault | Once, desktop | One choice (travel setup or own templates), then forget settings exist |
| Start a trip | Few times a year | Name, dates, kind → note is created and opened |
| Fill in the plan: add entries, place activities on days | Many sessions | One gesture where the user is already looking (the day) |
| See the shape: free days, overlaps, what's on a day | Every session | Layout is a list of days; problems show on the day they affect |
| Change plans: shift a stay, extend by a night, move/reorder activities | Often, desktop, in batches | Direct manipulation (drag, Alt+arrows), immediate write, Undo |
| Fix what the plugin can't read | Occasionally | Shown at the cause, with a way to resolve it |
| Adjust setup | Rarely | Findable via settings search, saves as you go |

Friction matches consequence: no ceremony for small reversible edits; explicit confirmation only for irreversible ones (deleting a note, forgetting the setup, changing the travel folder).

## 4. Decisions in force

- **D01 Preset is opt-in.** The author's workflow ships as the *travel setup* preset; anyone can start from their own templates. Both paths produce the same editable configuration.
- **D02/D03 Structural editor, no viewer.** The plugin edits itineraries (add/move/resize entries, place/move/reorder activities, detach, delete); viewing is Obsidian's job.
- **D04 Svelte** for UI inside native Obsidian views/modals. (Settings later moved to Obsidian's declarative settings, see §9.)
- **D05 Dates are the order.** Entries are ordered by start date (then end, then path for stable display). No plugin-only ordering; equal dates imply no intra-day order.
- **D06 Moving dates never rewrites body dates or prose.** After a move the result bar reminds the user that dates written inside the note didn't change.
- **D07/D12 Per-day activity assignment** via a configured body convention (date heading → *Activities* subheading → `- [[link]]` bullets). Placement edits touch only those bullets and the activity-list property.
- **D09 Desktop + mobile supported**; mobile = works and stays reachable at phone width (see §1). Real-device testing is reported as not done rather than claimed.
- **D10 Guided, bounded configuration.** Templates, folders, typed fields, semantic mappings, day-section format. No scripting, no Base-query builder, one active profile.
- **D11 Only the touched entry moves.** No ripple to neighbours. Overlaps and gaps are legal and shown. A move or resize that leaves the trip's range isn't written; the row offers **Extend trip to …** instead. *(Originally a multi-select "move several entries" form with preview; removed in favour of moving each entry with Alt+↓.)*
- **D12 Stale day placements stay where they're written.** After a move, activities on days now outside the entry stay on their absolute date, shown as "outside <entry>" (or under *Outside the trip*), until the user moves or removes them. Removing a day bullet keeps list membership while other days still use it; taking an activity off its only day also removes it from that entry's list. Moving between entries edits both notes.
- **D13 Non-destructive adoption and honest failure.** Existing notes are recognised without migration; setup never overwrites existing templates/Bases. *Detach* removes only the parent link. Deleting is separate, confirmed, uses Obsidian's own deletion prompt and trash setting, and never cascades. Multi-file writes are sequential; on failure, report written/failed/untouched files with **Retry** (no double shifts), **Undo** (restores written files), **Dismiss**. Nothing is rolled back automatically. *(Undo is user-initiated and byte-guarded, which is why it doesn't conflict with "no automatic rollback".)*
- **D14 Context-aware creation and a workspace tab.** Creation is a modal that takes the trip and kind from context. The itinerary editor is a normal main-workspace tab per trip, beside note tabs, not embedded in the note.
- **D15 Template date tokens:** `{{start_date}}`, `{{end_date}}`; legacy `{{date}}` = start. Mapped frontmatter dates always come from the form, regardless of tokens.
- **D16/D21 Day-section generation is a per-kind setting** (on for Planning in the preset), applied at creation only, for every day of the inclusive range. Template prose is preserved; complete matching sections are reused; a unique date heading missing its activity subsection gets one appended before the next same-or-higher heading; ambiguous duplicates abort creation before any write, keeping the form input. Never regenerated on later edits.
- **D17 Valid trip dates are a prerequisite** for creating or scheduling dated entries (both present, valid, start ≤ end). Out-of-range entries are diagnosed, never auto-repaired.
- **D18 Preset installs** templates to `_templates/` and Bases to `_templates/Bases/`, with a preview grouped by folder marking each file *new* or *already there, kept*. Other layouts pick templates explicitly; links are validated, never rewritten.
- **D19 Unsafe new names are rejected, not normalised:** empty/whitespace, `.`/`..`, trailing space/period, U+0000–U+001F, U+007F, `/ \ : * ? " < > | # ^ [ ]`, reserved Windows basenames (`CON`, `PRN`, `AUX`, `NUL`, `COM1–9`, `LPT1–9`, any case, with extension). Unicode, inner spaces, `&`, `()` are kept. Existing names are never touched.
- **D20 Placeholders.** Path: exactly `{{trip_name}}`, `{{entry_name}}`, `{{trip_start_year}}` (no current-year fallback; on trip creation both names are the trip's). Dates: ISO by default; any Moment.js format after a colon (`{{start_date:DD.MM.YYYY}}`). Day headings use any Moment format that round-trips a date; default `YYYY-MM-DD`. *(Originally limited to two formats; widened when date handling moved to Obsidian's bundled Moment.)*

## 5. Configuration model

- `Profile { name, scopes[], types: NoteType[] }`, plus `resolutions` (user's choice of kind/parent for ambiguous notes, keyed by path; stale choices are ignored).
- `NoteType { id, label, role, template, minimalBody, pathPattern, recognition {property, value}, basePath, baseProperty, dated, fields[], mappings {start, end, parent, activities}, days {enabled, dateFormat, headingLevel, activityHeading, activityLevel}, contains? }`.
- Field types: text, number, boolean, date, URL, text list, note link, note-link list. Fields come from the template's properties; the user confirms them. Protected values (recognition/Base link, parent link) are never ordinary fields; mappings and custom fields can't reuse them.
- **Shared property names** (start, end, trip link, activity list, Base link) are edited once for the whole profile; renaming doesn't rename properties in notes.
- **Contains** (trip kinds): the explicit list of entry/activity kinds a trip of that kind holds. Governs what *Add to trip* and the trip tab offer; existing notes of other kinds still show. Profiles without it fall back to "kinds whose Base the trip template embeds".
- **Travel folder**: one folder in the UI (where trips are found and saved). Changing it confirms, then updates the scope and the save path of every kind that saved under the old folder.
- Saving: every settings change is validated against a candidate profile and saved only if it introduces no new problem; otherwise the reason shows at the field and the last valid profile stays active. Saves are serialised.
- Preset contents: trip kinds Simple (contains nothing), Advanced (Planning, Activity), Roadtrip (Stop); entry kinds Planning (day sections on) and Stop; Activity. Properties `base`, `backlink`, `startDate`, `endDate`, `Activities`, `Persons`, `Location`, `Done`, `banner`. Bases: Travel, Planning, Activities, Roadtrip. Sample text in English; dates ISO; times 24-hour. Paths: simple trips `Travel/{{trip_start_year}}/{{trip_name}}.md`; other trips `Travel/{{trip_start_year}}/{{trip_name}}/{{entry_name}}.md`; children in `Planning/`, `Roadtrip/` (stops) or `Activities/` under the trip folder.
- *Own templates* setup: pick a template or create a starter one (`startDate: "{{start_date}}"`, `endDate: "{{end_date}}"`); date properties are detected from the date placeholders whatever they're named; other properties become fields. Creates one trip kind.

## 6. Recognition and discovery

- Only configured scopes are scanned; an in-memory index is rebuilt on vault events (coalesced). Notes outside scope are not represented, and the UI says so rather than widening the scan.
- A note matches a kind by its recognition property/value. When several trip kinds share one (all preset trips link `Travel.base`), the **embedded Bases** decide (Planning/Activities → Advanced, Roadtrip → Roadtrip, none → Simple), and explicit *Contains* lists narrow likewise. Remaining ambiguity is a diagnostic, never a guess.
- Parent links resolve like Obsidian does: exact path first, then unique path suffix (`[[2026/Lisbon]]`), resolved against all vault paths before filtering to recognised trips. Two matches stay ambiguous.
- A child with **no** parent link is *detached*: a valid state (structural `detached` flag), not a problem.
- Wrong-typed mapped properties (scalar where a list is required) block dependent edits only. Empty/null optional lists mean "none". Discovery never writes.
- **Review notes that need attention** lists ambiguous-kind and broken-parent notes (newest trips first); choosing one opens it and asks which kind/trip. The answer is stored in settings, not in the note.

## 7. Creation

- Commands: **Create trip…** (asks kind if several), **Add to trip…** (current trip or picker, offers only contained kinds), **Edit trip properties…**, **Edit trip itinerary**, **Review notes that need attention**.
- One inline form: name, start, end, then template fields (booleans as toggles; URL fields validated for `https://`; lists "one per line"). End can't precede start; picking a start never changes the end. Entry dates must fall within the trip. Destination path is shown; collisions and unsafe names are reported before writing. No destination override.
- Day plans/stops can pick existing trip activities, each either just on the list or on one of the entry's days (written under that day's *Activities* heading).
- Cleared optional fields are written empty (`null`), not reverted to template defaults. Unknown placeholders are named before saving. Templates never execute code.
- New notes link to their trip with Obsidian's shortest unambiguous link (`[[Lisbon]]`).
- Property edits (**Save**, no preview) change frontmatter only; body stays byte-identical; a stale file blocks the save and keeps the draft.
- Partial creation failures name what was and wasn't created.

## 8. The trip tab

Purpose: editing what is painful in plain notes because it spans several notes or sections. It is not a second itinerary to read.

**Layout:** header (trip name = link to the note; dates = button that edits them inline; ⋯ menu: Switch trip…, Delete…). **Needs attention** only when needed. **Not on a day** (unplaced activities, count, + Activity). Then **one row per trip day**, start to end. Each day lists the entries covering it (stacked; on a changeover day the ending one first), each with a colour tone, its name bold on its first day and faint after; under each entry, that day's activities in note order. Days without an entry read *Nothing planned* with **+ <Kind>** for each kind the trip contains. Overlaps beyond a changeover day get a warning icon on the day. Activities whose date lies outside the trip are listed under **Outside the trip**. Unresolvable links (no note, or several notes with the name) show as plain text with an explanation and can't be dragged. Several trips can be open in separate tabs; the command switches to an already open one.

**Editing** (each change is written immediately):

| Want | Mouse | Keyboard |
|---|---|---|
| Move an entry | Drag its name to another start day | Alt+↑/↓ |
| Change first/last day | Drag the handle on that day | Alt+Shift+↑/↓ |
| Move an activity to another day/entry | Drag | Alt+↑/↓ |
| Reorder within a day | Drag | Alt+↑/↓ (past the end → next day) |
| Place a collected activity | Drag from *Not on a day* | Menu → Put on a day… |
| Take off a day | Drag to *Not on a day*, or hover × | Delete |

Every row also has a context menu (right-click/menu key) repeating these plus Open note, Remove from <entry>, Detach from trip / Attach to this trip, Delete…. Hover-only controls (⠿, ×, +, …) appear on hover/focus. Keyboard steps stop at the trip's edges with a message.

**Result bar:** says what happened, includes the D06 reminder for date moves, offers **Undo**; auto-hides after ~8 s unless hovered/focused. Undo writes back each touched file's exact previous bytes only if the file still matches what was written; otherwise it names the changed file and writes nothing. Undo works even if the note has meanwhile left the index. Delete can't be undone here (Obsidian's trash).

**Gate rules for this UI:** states (no dates → ask for dates; no entries → every day "Nothing planned"; simple trip → one line saying there's nothing to plan); focus stays on the moved item; optimistic move reverts with an inline reason on failure; long names truncate with full name available; container landmarks use `aria-labelledby`, not `aria-label` (Obsidian shows a tooltip for any `aria-label`); results announced via persistent live regions; no drag animation under `prefers-reduced-motion`; icon buttons square, 44 px targets at phone width.

## 9. Writing files safely

- Every write re-reads the file and compares with what the view/form read (CRLF-tolerant, includes unsaved editor buffers); a mismatch stops with "File changed … Nothing was saved; reload it and try again." No force-overwrite.
- Frontmatter edits use `processFrontMatter`; unknown properties are preserved (YAML formatting may change). Body edits preserve untouched bytes and line endings.
- Batch writes: preflight all sources, write sequentially, record a receipt per step (exact bytes for content edits; property edits accepted only if the read-back body is unchanged and properties match exactly), re-check earlier receipts before each later write, stop at first failure, report written/failed/untouched. Renames during a write are detected.
- Body scanning (`contentLines`) ignores fenced code, `%%` and HTML comments; a note ending inside an unclosed fence/comment refuses edits. Duplicate date headings or activity subsections make that edit ambiguous and stop it. Missing day/activities headings are added at the right place (bullet appended after the last activity bullet, before trailing prose).
- Deleting goes through `fileManager.promptForDeletion` (honours the vault's confirm and trash settings); cancelling is a quiet no-op. Folders are created with `vault.createFolder`.
- Paths stay inside the vault, outside config/trash; no traversal or silent overwrite.

## 10. Architecture and tooling

- `src/config` (profile, validation, storage, preset, template rendering, recognition, shared properties), `src/discovery` (index, attention), `src/travel` (dates, schedule, assignments, day sections, removal), `src/editing` (batch, conflicts, properties), `src/creation`, `src/io/vault.ts` (Obsidian adapter), `src/ui` (Svelte views/modals, itinerary layout/operations/model), `src/settings.ts` (declarative settings), `src/main.ts` (lifecycle/commands). Pure logic is unit-tested without Obsidian (Vitest, `obsidian` aliased to a shim exporting Moment).
- Prefer native Obsidian APIs over hand-rolled code: declarative settings with sub-pages and search (`minAppVersion` 1.13.1), `ConfirmationModal`, Moment (`moment.utc` for date math, `getLanguage()` + `Intl` for labels), `getFrontMatterInfo`, `normalizePath`, `debounce`, `revealLeaf`, `Platform`, `setIcon`, `Keymap.isModEvent`/`openLinkText`, `hover-link`, `file-menu`. The day-heading scanner stays custom because Obsidian has no public synchronous parser for arbitrary text.
- CSS uses Obsidian variables (`--size-4-*`, `--input-height`, `--font-ui-small`, `--border-width`); only layout-specific dimensions get `--travel-*` variables.
- TypeScript 6, strict; ESLint = `@antfu/eslint-config` (TypeScript, Svelte, antislop) under `eslint-plugin-obsidianmd` recommended rules, which win on conflict; all lint and type checks must pass. Package manager pnpm (pinned in `packageManager`); install scripts only where `allowBuilds` permits, trust policy `no-downgrade`. Gates: `pnpm test`, `pnpm build`, `pnpm lint`, `pnpm check`.
- Tests live in `__tests__` folders beside the code; only tests that would catch a real regression are kept, and new fixes get a test that fails without the fix.
- `pnpm demo-vault [target] [--force]` generates a synthetic vault (34-day advanced trip with changeover days, an overlap, a free day, placed/unplaced activities, an activity outside its entry and one outside the trip, ambiguous and missing links; a roadtrip with a gap; simple trips across years) from the bundled preset.
- All UI copy and sample content in English.

## 11. Acceptance scenarios (what "works" means)

- Existing vault: install/reuse preset without touching notes; recognise existing trips (no attention items in a correctly configured vault); edit an existing multi-day entry without changing its prose.
- Blank vault with a different schema (`Journeys` folder, `begins`/`finishes`, `journey` parent, `visits` activities, ISO headings, custom label): create and edit a trip without the preset; notes readable with the plugin disabled.
- Creation: distinct start/end rendering, legacy `{{date}}`, generation cases of D16/D21, D17 blocking, D19 name cases, D20 placeholder validation, collisions.
- Trip tab: each day once and matching the files; changeover, overlap, gap; every move/resize/reorder by mouse and keyboard; Undo byte-exact and refused after external edit; out-of-trip → Extend; stale file blocks; partial two-file failure → Retry/Undo; detached notes not flagged.
- Failure/coexistence: dirty external edit, same-basename activities, malformed YAML, scalar-instead-of-list, fenced/commented headings, interrupted batch, detach with remaining body link, delete without cascade, unload with views open (no late writes or leaked handlers).
- Accessibility: keyboard-only reachability, accessible names via native semantics, focus restoration. Real screen readers and real phones remain unverified until done.

## 12. Out of scope

Separate viewer, maps, bookings, route optimisation, network services, scripting/Templater execution, generated Base queries, migration/normalisation of existing notes, automatic renames on date change, converting a trip to another kind, ripple scheduling, "shift everything from this day" (possible later), durable undo history/crash recovery, cross-device conflict resolution, multiple active profiles, whole-trip recursive delete.

## 13. How we got here

1. **Spec (D01–D21).** Derived from the author's existing template/Base workflow and Roamvault. Review rounds tightened date tokens, day-section generation, parent-date rules, install paths, name rules and incomplete sections.
2. **Waves 1–4.** Configuration/discovery → creation/property editing → itinerary/assignments → integration, each verified in disposable vaults including a blank custom-schema vault.
3. **Native look, less clutter.** Settings had ~250 controls; reduced to an overview with per-kind pages and progressive disclosure; native Obsidian controls; copy trimmed.
4. **Task-centred rework.** UI reorganised around the jobs in §3: actions at the trip/day/entry they change, context-aware creation, attention shown at the cause, previews only for consequential changes.
5. **First-run review.** Name **Trips** / ID `trips`; commands *Add to trip*, *Edit trip properties*; explicit *Contains*; property Save without preview; no destination override; inline fields; shortest trip links; destructive actions as warning row + confirmation instead of accordions.
6. **Trip tab from first principles.** Days instead of a list of notes; drag and Alt+arrows instead of a move form; Undo instead of previews; activity reordering and entry resizing added; multi-select move removed. A first version drew entries as multi-day lane bars with end dots and a side column; it was replaced by the stacked single-column agenda with colour tones because the bars misaligned and the dots felt foreign to an agenda.
7. **Hardening.** Several adversarial code and test reviews: byte-exact receipts, comment-aware scanning, embedded-Base kind narrowing, reserved-property validation, detached as a state, per-step freshness checks.
8. **Platform alignment.** Declarative settings (min Obsidian 1.13.1), native deletion prompt and other native APIs, Obsidian CSS variables, accessibility pass (native semantics over `aria-label`), strict antfu linting, TypeScript 6, English sample content with ISO dates, generated demo vault.
