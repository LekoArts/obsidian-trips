# Trips

![Obsidian 1.13.1+](https://img.shields.io/badge/Obsidian-1.13.1+-483699?logo=obsidian) ![CI](https://github.com/LekoArts/obsidian-trips/actions/workflows/ci.yml/badge.svg) ![License: MIT](https://img.shields.io/badge/license-MIT-blue)

Plan trips in Obsidian. Creates trip notes from your templates, puts them in the right folder with the right dates and links, and gives each trip a tab where you rearrange its days and activities. Your notes stay ordinary Markdown and work the same with the plugin disabled.

![How Trips works: fill in a trip name and dates, and Trips creates the trip note from your template in Travel/2026, with dates filled in. Add a day plan such as Busan with an activity, and Trips files Busan.md in the trip's folder, linked to the trip, with its dates and a section for every day, the activity under its day. The trip note's Base lists the plan.](https://raw.githubusercontent.com/LekoArts/obsidian-trips/main/images/trips.svg)

## Use it

1. **Settings → Trips**: install the travel setup or pick your own templates.
2. **Create trip** makes a trip note.
3. With a trip open, **Add to trip** adds day plans, stops and activities, and **Edit trip itinerary** opens the trip tab.

The trip tab lists every day of the trip with the stays and activities on it. Drag an entry or an activity to another day, or focus it and press Alt+↑/↓. Alt+Shift+↑/↓ on a stay gives it one night less or more. Activities you collected but haven't scheduled sit under *Not on a day*, ready to drag in. Each change is written to your notes right away and can be undone from the bar at the bottom.

Requires Obsidian 1.13.1 or later. Works on desktop and mobile.

## Privacy

Trips works offline. It makes no network requests, collects no telemetry and needs no account. It only reads and writes notes inside your vault.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
