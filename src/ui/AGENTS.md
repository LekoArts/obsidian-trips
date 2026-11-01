Svelte 5 components mounted from Obsidian Modal and ItemView classes; settings are Obsidian declarative settings in src/settings.ts, not Svelte.
pnpm check must report 0 errors and 0 warnings. Keep decisions in .ts files (itinerary/layout.ts, itinerary/operations.ts, creation/fields.ts) so Vitest can test them.

The trip tab is for editing, mostly on desktop; the trip note's Base is for viewing. It must still work at phone width: no horizontal overflow, every action reachable by tap or menu, 44px targets.
Edits apply directly with an Undo bar, no previews. Keep keyboard parity with drag (Alt+Up/Down move, Alt+Shift+Up/Down resize, Delete removes from a day) and keep focus on the moved item.

Before shipping, check empty, loading, error and partial-write states, keyboard-only use, realistic content (34-day trip, overlaps, long names, 30 activities in a day), that the screen matches the files, and that no fact is shown twice. Copy is short and says what happened.

Native elements and visible text first. aria-label only on icon-only controls: Obsidian shows it as a tooltip, so never put it on containers; use aria-labelledby or aria-describedby. Status and errors go to persistent live regions.

CSS lives in styles.css under .travel-planner and uses Obsidian variables (size-4-*, input-height, font-ui-small, border-width, theme colours); add a travel- variable only for a layout size Obsidian lacks. Icons via setIcon (src/ui/icon.ts), never text glyphs. Respect prefers-reduced-motion.

Verify UI changes live in a demo vault at desktop width and at 400px, with measurements or screenshots.
