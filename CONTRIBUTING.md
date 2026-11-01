# Contributing

Bug reports and ideas are welcome as [GitHub issues](https://github.com/LekoArts/obsidian-trips/issues). Include your Obsidian version, platform and, for bugs, the steps to reproduce. Leave out personal vault content.

## Develop

```sh
pnpm install --frozen-lockfile
pnpm test && pnpm lint && pnpm check && pnpm build
pnpm demo-vault /tmp/trips-demo --force
```

The last command writes a demo vault with the built plugin copied in. Open it in Obsidian to try changes; don't test against your own vault.

## Pull requests

- Keep notes untouched unless the user asked for the change; the Markdown files are the source of truth.
- A bug fix comes with a test that fails without it.
- All four checks must pass. Fix the code rather than relaxing a lint rule.
- Add a changeset for anything users will notice: `pnpm changeset`.

## Releases

Merging changesets into `main` opens a "Version packages" pull request. Merging that pull request publishes a GitHub release tagged with the new version, with attested `main.js`, `manifest.json` and `styles.css`.
