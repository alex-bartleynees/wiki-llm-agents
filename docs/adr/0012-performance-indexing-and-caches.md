# Indexing, SQLite settings, and in-memory caches

Four performance choices trade simplicity or durability margins for latency across indexing, reading, and searching vaults.

## SQLite connection pragmas

`shared/persistence/sqlite.ts` opens SQLite in WAL mode with `synchronous = NORMAL`, `busy_timeout = 5000`, `cache_size = -64000`, `temp_store = MEMORY`, and `mmap_size = 268435456`, and runs `PRAGMA optimize` on close (logging any failure rather than swallowing it).

- **`synchronous = NORMAL` in WAL mode** avoids an `fdatasync` on every transaction commit, which otherwise stalls bulk indexing and streaming thread event writes. The SQLite WAL guarantee holds across process crashes; only an OS crash or sudden power loss before a checkpoint can roll back the most recent committed transactions. The vault index is derived from disk and rebuildable, and local-first thread history trades that narrow power-loss window for responsive streaming and indexing.
- **`mmap_size = 268435456`** maps up to 256 MiB of the database file for fast read-only page access on localhost. SQLite falls back to normal `read()` calls beyond the limit or when the OS refuses `mmap`.
- **`PRAGMA optimize` on close** updates query planner statistics from observed index usage without paying the cost on startup.

## Explicit `notes.fts_rowid` for `notes_fts`

`notes_fts` stores `vault_id` and `path` as `UNINDEXED` columns so search never matches file paths. Deleting or replacing an FTS row with `WHERE vault_id = ? AND path = ?` therefore scanned the entire FTS5 table on every note edit or deletion.

Using `notes`'s implicit `rowid` directly would be fragile: `notes` has a composite primary key `(vault_id, path)` rather than an `INTEGER PRIMARY KEY`, so `VACUUM` or a future table-rebuilding migration could renumber `notes.rowid` and silently point FTS rows at the wrong notes.

Instead, `notes.fts_rowid` stores the explicit `rowid` assigned by FTS5 when each row is inserted into `notes_fts`. Regular integer columns on `notes` and FTS5's internal `%_content(id INTEGER PRIMARY KEY)` rowids are both stable across `VACUUM` and table rebuilds. Migration `0033_rekey_notes_fts.sql` deduplicates any duplicate `(vault_id, path)` rows in `notes_fts` (keeping the highest `rowid`), drops orphaned `notes_fts` rows whose note no longer exists, and populates `notes.fts_rowid`. Runtime updates and deletions delete `notes_fts` by `WHERE rowid = ?` in O(log N) (falling back to `(vault_id, path)` only if `fts_rowid` is null).

## Per-vault in-memory index caches

`IndexStoreLive` (`features/indexing/sqlite-store.ts`) owns both `IndexStore` (writes) and `VaultIndex` (reads) for one server process, and lazily caches per-vault derived read structures:

- sorted `files` (for the file tree)
- `titledFiles` (for quick switching and link resolution)
- `LinkIndex` (for note rendering, link resolution, and incremental indexing)
- `tags` (frontmatter tag counts)
- `VaultNoteGraph` (adjacency, `byPath`, `byTag`, and `byFolder` maps for related notes and MCP search hops)

Every write path (`putBatch`, `remove`, `clear`) invalidates the affected vault's cache inside a `finally` block so even a partial failure across batched transactions never leaves stale entries behind. `setLinkTargets` invalidates only `noteGraph`. When `putBatch` updates existing notes without adding or removing any vault path (`pathsChanged: false`), `LinkIndex` is preserved because link resolution depends only on the set of file paths.

Because all vault-index writes flow through `IndexStore`, tests and production share the same invalidation path without cross-process coordination (the app assumes one server per data directory).

## Bounded LRU note render cache

`getNote` (`features/notes/get-note/use-case.ts`) keeps a 200-entry LRU cache of `renderNote` output keyed by `(vaultId, path)` and validated by exact equality on both the freshly read `markdown` string and the `LinkIndex` object reference from `VaultIndex.linkIndex(vaultId)`.

- Reading the file from disk on every request preserves "always current on disk" semantics and avoids mtime-granularity races.
- Checking `LinkIndex` object identity guarantees that adding, renaming, or removing any file in the vault invalidates cached renders whose wikilinks might now resolve differently, and prevents false cache hits across separate `TestApp` instances in the same process.
- Preserving `LinkIndex` across body-only edits to other notes keeps cached renders of unrelated notes warm.
