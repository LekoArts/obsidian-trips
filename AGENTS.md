Use the most specific AGENTS.md: for UI work read src/ui/AGENTS.md, before writing files read src/editing/AGENTS.md.
README.md is user-facing; keep its commands, labels and keyboard table in sync with the UI.

Markdown notes are the source of truth and must stay useful with the plugin disabled. Never normalise, migrate or rewrite content the user didn't ask to change.

Gates, all must pass: pnpm test, pnpm build, pnpm lint, pnpm check. Focused test: pnpm vitest run <file>. Fresh clone: pnpm install --frozen-lockfile.
Lint is antfu's config under eslint-plugin-obsidianmd, whose rules win. Fix code, not lint rules; a needed exception is a scoped override in eslint.config.mts with a comment saying why.

Architecture: src/main.ts lifecycle and commands; src/settings.ts declarative settings; src/config profile, validation, preset, templates, recognition; src/discovery index and attention; src/travel dates, schedule, assignments, day sections; src/editing batch writes and Undo; src/creation; src/io/vault.ts is the only vault adapter; src/ui Svelte views and modals.
Keep logic pure; in tests obsidian resolves to src/__tests__/obsidian.ts. Prefer native Obsidian APIs (minAppVersion 1.13.1, check @since in obsidian.d.ts). Use Obsidian's moment, moment.utc for date math.

Tests: only ones that would catch a real regression. A bug fix gets a test that fails without the fix. Assert exact bytes for file edits against independently written expected text.
Comments explain why, sit on the declaration they describe and match current behaviour. UI copy and samples in English, dates YYYY-MM-DD, times 24-hour.

Live checks only in a vault made by pnpm demo-vault /tmp/trips-demo --force, never a personal one. Use the obsidian-cli skill to reload, inspect the DOM and capture errors. Afterwards restore touched notes and compare file hashes with a snapshot.
Commits explain why. Never commit main.js or vault data.
