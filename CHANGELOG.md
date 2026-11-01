# trips

## 1.1.2

### Patch Changes

- [#6](https://github.com/LekoArts/obsidian-trips/pull/6) [`2ee39cd`](https://github.com/LekoArts/obsidian-trips/commit/2ee39cd60271c29326149d41761ed08c943abb18) - When you install the travel setup in a vault whose existing notes write day headings in another date format, for example `## 10.05.2026` instead of `## 2026-05-10`, Trips now says so right away. Before, activities under those headings silently showed as not on a day. If the headings consistently use one format, it offers to switch the kind's day-heading format to it; if they mix formats, or a date could be read two ways, it names them instead. Notes are never changed. The day-heading format setting now previews today's full heading, for example `## 2026-11-01`.

## 1.1.1

### Patch Changes

- [#4](https://github.com/LekoArts/obsidian-trips/pull/4) [`3aaccf8`](https://github.com/LekoArts/obsidian-trips/commit/3aaccf82fabbd4ebcc898a33b8a63f8f49275bab) - Avoid CSS features that Obsidian's plugin review flags as only partially supported. In the trip tab, activities that aren't on a day now fill their columns row by row, in the same order the Tab key moves through them.

## 1.1.0

### Minor Changes

- [#2](https://github.com/LekoArts/obsidian-trips/pull/2) [`1413abe`](https://github.com/LekoArts/obsidian-trips/commit/1413abe49175fd3c146026357f412ed31709536a) - Plan trips from a script or an AI agent through the Obsidian CLI. Six new commands return JSON with an `ok` field: `trips:status` and `trips:kinds` describe your Trips setup, `trips:list` shows trips, their day plans, stops and activities, `trips:create` creates a trip or a note inside one, `trips:assign` adds, moves, reorders or removes an activity on a day, and `trips:reschedule` changes the dates of a day plan, stop or trip. Notes created or changed this way are identical to what the creation form and the trip tab write. `trips:status` and `trips:list` also list notes that need attention. The new `skills/trips/` folder is an agent skill that teaches an agent to use these commands; copy it into your agent's skills folder.

## 1.0.0

### Major Changes

- Initial release of Trips, a trip planner for Obsidian notes.

  - **Create trips from your templates.** Create trip makes a trip note from a template, files it in a folder for its year and fills in its dates and any properties you defined as form fields. Use the bundled travel setup (simple trips, trips with day plans and activities, road trips, plus the Bases that list them) or your own templates.
  - **Add day plans, stops and activities.** Add to trip creates notes inside the trip's folder, linked to the trip, with their dates and a section for every day. Activities can go straight under the day you plan them for.
  - **Rearrange a trip in its own tab.** Edit trip itinerary lists every day of the trip with its stays and activities. Drag a stay or an activity to another day, or use the keyboard: Alt+↑/↓ to move, Alt+Shift+↑/↓ to change a stay's length. Activities without a day wait under _Not on a day_. Every change is written to your notes immediately and can be undone.
  - **Safe with your notes.** Trips only changes the properties and sections an action is about, refuses to write a file that changed since it was read, and never migrates or reformats existing notes. Notes stay ordinary Markdown and keep working with the plugin disabled.
  - **Recognises existing trips** by their properties or Bases, and lists notes it can't place under _Review notes that need attention_.

  Requires Obsidian 1.13.1 or later. Works on desktop and mobile, offline, with no account or telemetry.
