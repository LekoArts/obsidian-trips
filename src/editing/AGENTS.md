Changes to existing notes go through a batch plan (batch.ts) applied via src/io/vault.ts; UI code never writes files. New notes go through createNote: the body via vault.create, which refuses an existing path, then properties via processFrontMatter.
Test: pnpm vitest run src/editing src/travel

Every change here must keep these rules:
Check freshness before every write; a file changed since it was read is not written, and the message says nothing was saved.
Property edits use processFrontMatter, body edits vault.process. Touch only the properties or section the action owns; other bytes stay identical.
Multi-file writes stop at the first failure and report written, failed and untouched files. Retry uses absolute targets, so nothing shifts twice. Never roll back automatically.
Receipts record exact resulting bytes. Undo restores previous bytes only if the file still matches its receipt, otherwise it names the file and writes nothing. Re-check earlier receipts before each later step.
Deleting uses fileManager.promptForDeletion; cancelling is a quiet no-op. Detach and delete never cascade to child notes.
Body scanning uses contentLines: ignore fenced code, %% and HTML comments; refuse edits when a note ends inside one; duplicate date or activity headings stop the edit before any write.
Moving an entry moves only that entry and only its frontmatter dates; body dates stay and the result says so.

Cover failure paths with TestVault injected failures (write, trash, external edit between steps) and assert exact file contents afterwards.
