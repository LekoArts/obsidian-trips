# Trips

![Obsidian 1.13.1+](https://img.shields.io/badge/Obsidian-1.13.1+-483699?logo=obsidian) ![CI](https://github.com/LekoArts/obsidian-trips/actions/workflows/ci.yml/badge.svg) ![License: MIT](https://img.shields.io/badge/license-MIT-blue)

Trips helps you plan trips in Obsidian. It creates trip notes from your templates, saves them in the right folder and fills in their dates and links. Each trip gets a tab where you move its days and activities around.

Your notes stay ordinary Markdown. They work the same when the plugin is turned off.

![How Trips works: fill in a trip name and dates, and Trips creates the trip note from your template in Travel/2026, with dates filled in. Add a day plan such as Busan with an activity, and Trips files Busan.md in the trip's folder, linked to the trip, with its dates and a section for every day, the activity under its day. The trip note's Base lists the plan.](https://raw.githubusercontent.com/LekoArts/obsidian-trips/main/images/trips.svg)

## Words used here

- **Trip**: one note for the whole trip, with a start and an end date.
- **Day plan** and **stop**: notes for part of a trip, such as three nights in one city. Each has its own dates inside the trip.
- **Activity**: a note for something to do, such as a museum. You can put it on one or more days.
- **Kind**: a type of note, with its own template and folder. The travel setup has the kinds Simple, Advanced and Roadtrip for trips, and Planning, Stop and Activity for notes inside a trip.

## Use it

All actions are commands. Open the command palette with Cmd+P (macOS) or Ctrl+P (Windows, Linux) and type "Trips".

### Set up Trips

1. Open **Settings → Trips**.
2. Choose one way to start:
   - **Use the travel setup** adds ready-made templates and Bases. You see the list of files first. Files already in your vault are never changed.
   - **Use my own templates** uses a note you pick as the trip template, or creates a starter one. Put `{{start_date}}` and `{{end_date}}` in the properties that hold the dates, for example `startDate: "{{start_date}}"`.
3. Optional: under **Travel folder**, choose where trips are saved. Trips also looks for existing trips there.

You can edit your templates like any note. Keep their properties and `{{…}}` placeholders, because Trips uses them to recognise and fill in notes.

### Create a trip

1. Run **Trips: Create trip…**.
2. If you have more than one trip kind, choose one. Simple trips are a single note. Advanced trips can hold day plans and activities. Road trips hold stops.
3. Enter a name, a start date and an end date. The end date can't be before the start date.
4. Fill in any other fields from your template and select **Create**.

Trips saves the note in the folder shown under the name, for example `Travel/2026/South Korea/South Korea.md`, and opens it.

### Add a day plan, stop or activity

1. Open the trip note.
2. Run **Trips: Add to trip…** and choose what to add.
3. Enter a name and dates. Dates must be inside the trip's dates.
4. For a day plan, you can select **Add activity…** to link activities and choose a day for each.
5. Select **Create**.

The new note links back to the trip and gets a section for each of its days. If you run the command without a trip open, Trips asks which trip to use.

### Edit a trip's properties

Open a trip note, run **Trips: Edit trip properties…**, change the fields and select **Save**. If the note changed since you opened the form, nothing is saved. Reload the form and try again.

### Plan the days

Open a trip note and run **Trips: Edit trip itinerary**. A tab opens with every day of the trip and the day plans, stops and activities on each day.

In this tab you can:

- **Change the trip's dates**: select the dates under the trip name, or use **Trip actions → Change trip dates**.
- **Move a day plan or stop**: drag it to another day, or use its **⋯** menu: **One day earlier** or **One day later**.
- **Make a stay longer or shorter**: use **One night longer** or **One night shorter** in its menu. To set exact dates, use **Change dates…**.
- **Put an activity on a day**: drag it from **Not on a day**, or select **+** on a day and choose or create an activity.
- **Move an activity**: drag it to another day or another place in the list, or use **Move to day…** in its menu.
- **Take an activity off a day**: select **×** next to it. The activity note stays.
- **Detach or delete a note**: use **Detach from trip** or **Delete…** in its menu. Detached notes stay in your vault but no longer belong to the trip.
- **Open a note**: select its name. Cmd-click (macOS) or Ctrl-click opens it in a new tab.

Each change is saved to your notes at once. To reverse the last change, select **Undo** in the bar at the bottom. Undo only works while the changed notes are as Trips left them.

Moving a day plan or stop changes only its date properties. Check dates and day headings you wrote in the note text yourself.

#### Keyboard

| Keys | Focused item | Action |
| --- | --- | --- |
| Alt+↑ / Alt+↓ | Day plan or stop | Move one day earlier or later |
| Alt+Shift+↑ / Alt+Shift+↓ | Day plan or stop | One night shorter or longer |
| Alt+↑ / Alt+↓ | Activity on a day | Move up or down, onto the next day at the ends |
| Delete or Backspace | Activity on a day | Take it off that day |
| Escape | Date editor | Close without saving |

### Fix notes Trips can't read

Run **Trips: Review notes that need attention**. It lists notes that Trips can't match to one kind or one trip. Pick a note, then choose its kind or trip. Trips remembers your choice and doesn't change the note.

## Requirements

Obsidian 1.13.1 or later. Works on desktop and mobile. Planning days works best on a larger screen; on a phone, the trip note's Base shows the plan.

## Privacy

Trips works offline. It makes no network requests, collects no telemetry and needs no account. It only reads and writes notes inside your vault.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
