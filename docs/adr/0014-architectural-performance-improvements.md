# Architectural performance improvements

Seven architectural improvements reduce SQLite write/read overhead, subprocess spawns, HTTP transfer size, and redundant browser work across vaults, threads, and projects.

## 1. Leading/trailing-edge `message.delta` coalescing in `ThreadActor`

`ThreadActor` (`features/threads/thread-actor.ts`) preserves two invariants: SQLite is written before SSE publication, and `thread_events.seq` stays strictly gapless (`1..lastSeq`) so reconnecting SSE clients resume cleanly from `after`.

To avoid opening a SQLite transaction for every provider token chunk without violating either invariant:

- The mailbox loop drains all currently queued messages (`Queue.takeAll`) and merges adjacent `ProviderEvent(message.delta)` entries for the same `(turnId, messageId)`.
- The first delta flushes immediately (zero time-to-first-token latency) and enters a 40 ms cooldown window. Subsequent deltas for the same `(turnId, messageId)` buffer in memory and flush together when the 40 ms window expires, when `messageId` changes, or atomically inside the same transaction when any non-delta event (`tool.called`, `request.opened`, `turn.finished`, etc.) is recorded.
- An actor-scope finalizer flushes any remaining buffered delta on graceful shutdown.

Post-turn row compaction (deleting earlier `seq` rows) was not chosen because deleting rows creates `seq` gaps that cause a client reconnecting mid-turn to duplicate already-received prefix text.

## 2. Materialized thread summary columns on `threads`

`ThreadRepository` (`features/threads/sqlite-repository.ts`) previously ran seven correlated subqueries per thread row in `summaryColumns` and two `EXISTS` subqueries in `listActive`.

`threads` now stores `last_seq`, `status`, `active_subagents`, `running_turn_json`, `last_turn_json`, and `continued_in_thread_id`, indexed by a partial index `threads_active_idx` (`WHERE status <> 'idle' OR active_subagents > 0`).

- `insert` updates `continued_in_thread_id` on the source thread inside the same transaction.
- `append` always updates `last_seq` and `updated_at`, and recomputes the four turn/request/subagent columns only when the appended batch contains a lifecycle event (`user.message`, `compaction.requested`, `handoff.requested`, `subagent.reported`, `subagent.updated`, `request.opened`, `request.resolved`, `plan.updated`, `turn.finished`). Streaming `message.delta` writes pay zero extra summary queries.
- Migration `0035_backfill_summaries_and_note_tags.sql` backfills all existing rows.

## 3. Normalized `note_tags` table and precomputed `notes.lead`

`note_tags(vault_id, tag, path)` (primary key `(vault_id, tag, path)`, secondary covering index `(vault_id, path, tag)`) stores ASCII-lowercased frontmatter tags so exact and hierarchical tag filters (`tag = ? OR (tag >= 't/' AND tag < 't0')`) use B-tree range scans instead of `json_each(notes.tags)`.

`notes.lead` stores the precomputed 200-character plain-text lead preview at index time (`computeLead` in `features/indexing/fts-query.ts`), removing the `blobs` join from tag-only searches. Migration `0035` backfills both from existing `notes` and `notes_fts`.

## 4. HTTP compression (`br`/`gzip`) and conditional `ETag` / `304 Not Modified`

- `CompressionLive` (`shared/compression.ts`) mounts Effect's `HttpMiddleware.compression` as a global `HttpRouter.middleware`, negotiating `br` (level 4, preferred) or `gzip` (level 6) via `NodeHttpPlatform` for `Uint8Array`, `Stream`, and `Raw` (static file) responses of at least 1,024 bytes. It supplies a custom `compressible` predicate (`isCompressibleContentType`) that excludes `text/event-stream` (since Effect's default matches all `text/*`) and binary MIME types, while delegating `Vary: Accept-Encoding`, `Content-Length` handling, and RFC 9110 strong-to-weak `ETag` weakening to `HttpMiddleware.compression`.
- `respondWithEtag` (`shared/etag.ts`) checks `If-None-Match` using RFC 9110 weak comparison and returns `304 Not Modified` with `Cache-Control: no-cache` on match.
  - `get-tree` checks the cached per-vault tree fingerprint in `VaultIndex.treeEtag` before building or encoding entries.
  - `get-note` hashes `(vaultId, path, markdownHash, treeEtag, modifiedAt, lastAgentEdit)` using the render cache's stored markdown hash and `VaultIndex.treeEtag` (content-derived, so ETags remain valid across restarts).
  - `get-thread` computes its ETag from `ThreadSummary` before querying or decoding `thread_events`.

## 5. Structural vs. content vault events

`VaultChanged` (`packages/contracts/src/indexing/event.ts`) carries an optional `structureChanged: boolean` flag (`true` when paths are added, removed, or renamed, a note's title changes, or the index is rebuilt; `false` for body-only edits).

`VaultEventsStore` (`apps/web/src/lib/features/indexing/vault-events.svelte.ts`) exposes `structureRevision` alongside `revision` and `versionOf(path)`. `VaultPane` (tree and pins), `NoteView` (reading view, alongside `versionOf(path)`), and `AgentText` (citation resolution cache) watch `structureRevision`, skipping reloads on unrelated body-only edits.

## 6. Two-process `branchStatus` via `git status --porcelain=v2 --branch`

`branchStatus` (`features/projects/git/status.ts`) replaces up to seven `git` subprocess calls across two sequential batches with two parallel calls: `git status --porcelain=v2 --branch --untracked-files=no` and `git config --null --get-regexp`, parsed by pure `parseBranchStatus`. Local upstreams (`remote = "."`) continue to be treated as no upstream, and unborn branches and detached `HEAD`s are preserved identically.

## 7. Client-side Quick Switcher filtering and `content-visibility: auto`

- `TreeEntry` includes optional `title`, populated from `VaultIndex.titledFiles` (sorted by `comparePaths`).
- `packages/search/src/fuzzy.ts` (`@wiki-agents/search`) shares `fuzzyMatch`, `normaliseFuzzyQuery`, and `rankQuickSwitch` between server and web. It is its own package with no dependencies, not part of contracts. Contracts holds wire schemas only, and the ranking is generic over the file kind so it doesn't import contracts' types.
- `TreeStore.match(vaultId, query)` runs fuzzy matching synchronously against the loaded vault tree; `QuickSwitcher`, `Composer` `@mentions`, `NotePicker`, and CodeMirror `[[` wikilink completions use it with zero network round-trips when loaded and fall back to `/quick-switch` otherwise.
- `FileTree` file rows and `ThreadView` timeline items apply `content-visibility: auto` with `contain-intrinsic-block-size` so large vaults and long multi-turn conversations skip off-screen layout and paint.
