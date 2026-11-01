---
"trips": minor
---

Plan trips from a script or an AI agent through the Obsidian CLI. Six new commands return JSON with an `ok` field: `trips:status` and `trips:kinds` describe your Trips setup, `trips:list` shows trips, their day plans, stops and activities, `trips:create` creates a trip or a note inside one, `trips:assign` adds, moves, reorders or removes an activity on a day, and `trips:reschedule` changes the dates of a day plan, stop or trip. Notes created or changed this way are identical to what the creation form and the trip tab write. `trips:status` and `trips:list` also list notes that need attention. The new `skills/trips/` folder is an agent skill that teaches an agent to use these commands; copy it into your agent's skills folder.
