import { posix } from "node:path";
import type { TagCount } from "@wiki-agents/contracts/search/list-tags/response";
import { and, asc, count, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { type LinkIndex, makeLinkIndex } from "../../shared/markdown/link-resolution.js";
import { comparePaths } from "../../shared/paths.js";
import { DbError } from "../../shared/persistence/errors.js";
import { Sqlite } from "../../shared/persistence/sqlite.js";
import { fileChanges } from "../changes/table.js";
import { folderFilter, searchNotes } from "./sqlite-search.js";
import { type IndexedFile, IndexStore, type NoteToIndex } from "./store.js";
import { blobs, links, notes, vaultFiles } from "./table.js";
import { buildNoteGraph, type NoteEdge, type NoteSummary, type TitledFile, VaultIndex, type VaultNoteGraph } from "./vault-index.js";

/** SQLite allows 32766 bound parameters; stay well below it. */
const CHUNK = 500;
const BATCH_TX = 250;
const chunks = <A>(items: ReadonlyArray<A>): Array<ReadonlyArray<A>> =>
  Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, index) => items.slice(index * CHUNK, (index + 1) * CHUNK));

interface VaultCache {
  files: ReadonlyArray<IndexedFile> | undefined;
  titledFiles: ReadonlyArray<TitledFile> | undefined;
  linkIndex: LinkIndex | undefined;
  tags: ReadonlyArray<TagCount> | undefined;
  noteGraph: VaultNoteGraph | undefined;
}

/** One adapter for both ports, over the shared connection. */
const make = Effect.gen(function* () {
  const { db } = yield* Sqlite;
  const query = <A>(run: () => A) => Effect.try({ try: run, catch: (cause) => new DbError({ cause }) });
  const transaction = <A>(run: () => A) => query(() => db.transaction(run));
  const caches = new Map<string, VaultCache>();

  const cacheOf = (vaultId: string): VaultCache => {
    let entry = caches.get(vaultId);
    if (entry === undefined) {
      entry = { files: undefined, titledFiles: undefined, linkIndex: undefined, tags: undefined, noteGraph: undefined };
      caches.set(vaultId, entry);
    }
    return entry;
  };

  const invalidateVault = (vaultId: string, pathsChanged = true) => {
    const entry = cacheOf(vaultId);
    entry.files = undefined;
    entry.titledFiles = undefined;
    if (pathsChanged) entry.linkIndex = undefined;
    entry.tags = undefined;
    entry.noteGraph = undefined;
  };

  const invalidateGraph = (vaultId: string) => {
    const entry = caches.get(vaultId);
    if (entry !== undefined) entry.noteGraph = undefined;
  };

  /**
   * Deletes blobs whose hash no note refers to any more, nor any recorded change
   * (change review needs the versions before and after a turn for diffs and undo).
   */
  const pruneBlobs = (hashes: ReadonlyArray<string>) => {
    for (const batch of chunks([...new Set(hashes)])) {
      db.run(
        sql`DELETE FROM ${blobs}
            WHERE ${blobs.hash} IN (${sql.join(batch.map((hash) => sql`${hash}`), sql`, `)})
              AND NOT EXISTS (SELECT 1 FROM ${notes} WHERE ${notes.contentHash} = ${blobs.hash})
              AND NOT EXISTS (SELECT 1 FROM ${fileChanges} WHERE ${fileChanges.beforeHash} = ${blobs.hash})
              AND NOT EXISTS (SELECT 1 FROM ${fileChanges} WHERE ${fileChanges.afterHash} = ${blobs.hash})`,
      );
    }
  };

  const upsertFileSync = (vaultId: string, file: IndexedFile) => {
    db.insert(vaultFiles)
      .values({ vaultId, ...file })
      .onConflictDoUpdate({
        target: [vaultFiles.vaultId, vaultFiles.path],
        set: { kind: file.kind, mtimeMs: file.mtimeMs, size: file.size },
      })
      .run();
  };

  const upsertNoteSync = (vaultId: string, file: IndexedFile, note: NoteToIndex): string | undefined => {
    const previous = db
      .select({ ftsRowid: notes.ftsRowid, hash: notes.contentHash })
      .from(notes)
      .where(and(eq(notes.vaultId, vaultId), eq(notes.path, file.path)))
      .get();
    db.insert(blobs).values({ hash: note.contentHash, content: note.content }).onConflictDoNothing().run();
    upsertFileSync(vaultId, file);
    if (previous?.ftsRowid != null) {
      db.run(sql`DELETE FROM notes_fts WHERE rowid = ${previous.ftsRowid}`);
    } else if (previous !== undefined) {
      db.run(sql`DELETE FROM notes_fts WHERE vault_id = ${vaultId} AND path = ${file.path}`);
    }
    const ftsInserted = db.run(
      sql`INSERT INTO notes_fts (vault_id, path, title, body, tags) VALUES (${vaultId}, ${file.path}, ${note.title}, ${note.body}, ${note.tags.join(" ")})`,
    );
    const ftsRowid = Number(ftsInserted.lastInsertRowid);
    const row = { title: note.title, frontmatter: note.frontmatter, tags: note.tags, contentHash: note.contentHash, ftsRowid };
    db.insert(notes)
      .values({ vaultId, path: file.path, ...row })
      .onConflictDoUpdate({ target: [notes.vaultId, notes.path], set: row })
      .run();
    db.delete(links).where(and(eq(links.vaultId, vaultId), eq(links.srcPath, file.path))).run();
    if (note.links.length > 0) {
      db.insert(links)
        .values(note.links.map((link) => ({ vaultId, srcPath: file.path, kind: link.kind, target: link.target, targetPath: link.targetPath ?? null })))
        .run();
    }
    return previous !== undefined && previous.hash !== note.contentHash ? previous.hash : undefined;
  };

  const removePaths = (vaultId: string, paths: ReadonlyArray<string>) => {
    const oldHashes: Array<string> = [];
    for (const batch of chunks(paths)) {
      const existing = db
        .select({ path: notes.path, ftsRowid: notes.ftsRowid, hash: notes.contentHash })
        .from(notes)
        .where(and(eq(notes.vaultId, vaultId), inArray(notes.path, batch)))
        .all();
      const rowids: Array<number> = [];
      const fallbackPaths: Array<string> = [];
      for (const row of existing) {
        if (row.ftsRowid !== null) rowids.push(row.ftsRowid);
        else fallbackPaths.push(row.path);
        oldHashes.push(row.hash);
      }
      db.delete(vaultFiles).where(and(eq(vaultFiles.vaultId, vaultId), inArray(vaultFiles.path, batch))).run();
      db.delete(notes).where(and(eq(notes.vaultId, vaultId), inArray(notes.path, batch))).run();
      db.delete(links).where(and(eq(links.vaultId, vaultId), inArray(links.srcPath, batch))).run();
      if (rowids.length > 0) {
        db.run(sql`DELETE FROM notes_fts WHERE rowid IN (${sql.join(rowids.map((id) => sql`${id}`), sql`, `)})`);
      }
      if (fallbackPaths.length > 0) {
        db.run(sql`DELETE FROM notes_fts WHERE vault_id = ${vaultId} AND path IN (${sql.join(fallbackPaths.map((path) => sql`${path}`), sql`, `)})`);
      }
    }
    pruneBlobs(oldHashes);
  };

  const loadFilesSync = (vaultId: string): ReadonlyArray<IndexedFile> => {
    const entry = cacheOf(vaultId);
    if (entry.files !== undefined) return entry.files;
    const rows = db
      .select({ path: vaultFiles.path, kind: vaultFiles.kind, mtimeMs: vaultFiles.mtimeMs, size: vaultFiles.size })
      .from(vaultFiles)
      .where(eq(vaultFiles.vaultId, vaultId))
      .all()
      // Same order as the vault walker (locale-aware, not SQLite's byte order).
      .sort((a, b) => comparePaths(a.path, b.path));
    entry.files = rows;
    return rows;
  };

  const loadTitledFilesSync = (vaultId: string): ReadonlyArray<TitledFile> => {
    const entry = cacheOf(vaultId);
    if (entry.titledFiles !== undefined) return entry.titledFiles;
    const rows = db
      .select({ path: vaultFiles.path, kind: vaultFiles.kind, title: notes.title })
      .from(vaultFiles)
      .leftJoin(notes, and(eq(notes.vaultId, vaultFiles.vaultId), eq(notes.path, vaultFiles.path)))
      .where(eq(vaultFiles.vaultId, vaultId))
      .all()
      .map((row) => ({ ...row, title: row.title ?? posix.basename(row.path) }));
    entry.titledFiles = rows;
    return rows;
  };

  const loadNoteGraphSync = (vaultId: string): VaultNoteGraph => {
    const entry = cacheOf(vaultId);
    if (entry.noteGraph !== undefined) return entry.noteGraph;
    const noteRows: ReadonlyArray<NoteSummary> = db
      .select({ path: notes.path, title: notes.title, tags: notes.tags })
      .from(notes)
      .where(eq(notes.vaultId, vaultId))
      .all();
    const edgeRows = db
      .selectDistinct({ from: links.srcPath, to: links.targetPath })
      .from(links)
      .innerJoin(notes, and(eq(notes.vaultId, links.vaultId), eq(notes.path, links.targetPath)))
      .where(and(eq(links.vaultId, vaultId), ne(links.kind, "embed"), ne(links.srcPath, links.targetPath)))
      .all();
    const edges: Array<NoteEdge> = [];
    for (const row of edgeRows) if (row.to !== null) edges.push({ from: row.from, to: row.to });
    const graph = buildNoteGraph(noteRows, edges);
    entry.noteGraph = graph;
    return graph;
  };

  const loadLinkIndexSync = (vaultId: string): LinkIndex => {
    const entry = cacheOf(vaultId);
    if (entry.linkIndex === undefined) {
      const all = loadFilesSync(vaultId);
      entry.linkIndex = makeLinkIndex(all.map((file) => file.path));
    }
    return entry.linkIndex;
  };

  const store = IndexStore.of({
    files: (vaultId) =>
      query(() =>
        db
          .select({
            path: vaultFiles.path,
            kind: vaultFiles.kind,
            mtimeMs: vaultFiles.mtimeMs,
            size: vaultFiles.size,
            contentHash: notes.contentHash,
          })
          .from(vaultFiles)
          .leftJoin(notes, and(eq(notes.vaultId, vaultFiles.vaultId), eq(notes.path, vaultFiles.path)))
          .where(eq(vaultFiles.vaultId, vaultId))
          .all(),
      ),

    filesByPath: (vaultId, paths) =>
      paths.length === 0
        ? Effect.succeed([])
        : query(() =>
            chunks([...new Set(paths)]).flatMap((batch) =>
              db
                .select({
                  path: vaultFiles.path,
                  kind: vaultFiles.kind,
                  mtimeMs: vaultFiles.mtimeMs,
                  size: vaultFiles.size,
                  contentHash: notes.contentHash,
                })
                .from(vaultFiles)
                .leftJoin(notes, and(eq(notes.vaultId, vaultFiles.vaultId), eq(notes.path, vaultFiles.path)))
                .where(and(eq(vaultFiles.vaultId, vaultId), inArray(vaultFiles.path, batch)))
                .all(),
            ),
          ),

    linkIndex: (vaultId) => query(() => loadLinkIndexSync(vaultId)),

    putBatch: (vaultId, batch) =>
      batch.files.length === 0 && batch.notes.length === 0
        ? Effect.void
        : query(() => {
            try {
              const replacedHashes: Array<string> = [];
              if (batch.files.length > 0) {
                db.transaction(() => {
                  for (const file of batch.files) upsertFileSync(vaultId, file);
                });
              }
              for (let start = 0; start < batch.notes.length; start += BATCH_TX) {
                const slice = batch.notes.slice(start, start + BATCH_TX);
                db.transaction(() => {
                  for (const item of slice) {
                    const replaced = upsertNoteSync(vaultId, item.file, item.note);
                    if (replaced !== undefined) replacedHashes.push(replaced);
                  }
                });
              }
              if (replacedHashes.length > 0) {
                db.transaction(() => {
                  pruneBlobs(replacedHashes);
                });
              }
            } finally {
              invalidateVault(vaultId, batch.pathsChanged);
            }
          }),

    remove: (vaultId, paths) =>
      paths.length === 0
        ? Effect.void
        : transaction(() => {
            removePaths(vaultId, paths);
            invalidateVault(vaultId);
          }),

    links: (vaultId) =>
      query(() =>
        db
          .select({ srcPath: links.srcPath, kind: links.kind, target: links.target, targetPath: links.targetPath })
          .from(links)
          .where(eq(links.vaultId, vaultId))
          .all(),
      ),

    setLinkTargets: (vaultId, updates) =>
      updates.length === 0
        ? Effect.void
        : transaction(() => {
            for (const link of updates) {
              db.update(links)
                .set({ targetPath: link.targetPath })
                .where(
                  and(
                    eq(links.vaultId, vaultId),
                    eq(links.srcPath, link.srcPath),
                    eq(links.kind, link.kind),
                    eq(links.target, link.target),
                  ),
                )
                .run();
            }
            invalidateGraph(vaultId);
          }),

    clear: (vaultId) =>
      transaction(() => {
        const oldHashes = db.select({ hash: notes.contentHash }).from(notes).where(eq(notes.vaultId, vaultId)).all().map((row) => row.hash);
        db.delete(vaultFiles).where(eq(vaultFiles.vaultId, vaultId)).run();
        db.delete(notes).where(eq(notes.vaultId, vaultId)).run();
        db.delete(links).where(eq(links.vaultId, vaultId)).run();
        db.run(sql`DELETE FROM notes_fts WHERE vault_id = ${vaultId}`);
        pruneBlobs(oldHashes);
        invalidateVault(vaultId);
      }),
  });

  const index = VaultIndex.of({
    files: (vaultId) => query(() => loadFilesSync(vaultId)),

    titledFiles: (vaultId) => query(() => loadTitledFilesSync(vaultId)),

    linkIndex: (vaultId) => query(() => loadLinkIndexSync(vaultId)),

    noteGraph: (vaultId) => query(() => loadNoteGraphSync(vaultId)),

    backlinks: (vaultId, path) =>
      query(() =>
        db
          .selectDistinct({ path: notes.path, title: notes.title })
          .from(links)
          .innerJoin(notes, and(eq(notes.vaultId, links.vaultId), eq(notes.path, links.srcPath)))
          .where(and(eq(links.vaultId, vaultId), eq(links.targetPath, path), ne(links.srcPath, path)))
          .orderBy(asc(sql`${notes.title} COLLATE NOCASE`), asc(notes.path))
          .all(),
      ),

    counts: (vaultId) =>
      query(() => {
        const files = db.select({ n: count() }).from(vaultFiles).where(eq(vaultFiles.vaultId, vaultId)).get();
        const noteCount = db.select({ n: count() }).from(notes).where(eq(notes.vaultId, vaultId)).get();
        return { files: files?.n ?? 0, notes: noteCount?.n ?? 0 };
      }),

    search: (vaultId, searchQuery) => query(() => searchNotes(db, vaultId, searchQuery)),

    tags: (vaultId) =>
      query(() => {
        const entry = cacheOf(vaultId);
        if (entry.tags !== undefined) return entry.tags;
        const rows = db.all<TagCount>(
          sql`SELECT t.value AS tag, count(*) AS count
              FROM notes, json_each(notes.tags) AS t
              WHERE notes.vault_id = ${vaultId} AND t.type = 'text'
              GROUP BY t.value
              ORDER BY count DESC, t.value COLLATE NOCASE`,
        );
        entry.tags = rows;
        return rows;
      }),

    notes: (vaultId, paths) =>
      query(() =>
        chunks([...new Set(paths)]).flatMap((batch) =>
          db
            .select({ path: notes.path, title: notes.title, tags: notes.tags })
            .from(notes)
            .where(and(eq(notes.vaultId, vaultId), inArray(notes.path, batch)))
            .all(),
        ),
      ),

    blobs: (hashes) =>
      query(
        () =>
          new Map(
            chunks([...new Set(hashes)]).flatMap((batch) =>
              db.select().from(blobs).where(inArray(blobs.hash, batch)).all().map((row) => [row.hash, row.content] as const),
            ),
          ),
      ),

    recentFiles: (vaultId, { since, limit, folders }) =>
      query(() => {
        const rows = db
          .select({ path: vaultFiles.path, kind: vaultFiles.kind, title: notes.title, modifiedAt: vaultFiles.mtimeMs })
          .from(vaultFiles)
          .leftJoin(notes, and(eq(notes.vaultId, vaultFiles.vaultId), eq(notes.path, vaultFiles.path)))
          .where(and(eq(vaultFiles.vaultId, vaultId), gte(vaultFiles.mtimeMs, since), sql`1${folderFilter(sql`${vaultFiles.path}`, folders)}`))
          .orderBy(desc(vaultFiles.mtimeMs), asc(vaultFiles.path))
          .limit(limit + 1)
          .all()
          .map((row) => ({ ...row, title: row.title ?? posix.basename(row.path) }));
        return { files: rows.slice(0, limit), truncated: rows.length > limit };
      }),
  });

  return { store, index };
});

/** Provides both `IndexStore` (indexer) and `VaultIndex` (readers). */
export const IndexStoreLive = Layer.effectContext(
  Effect.map(make, ({ store, index }) => Context.make(IndexStore, store).pipe(Context.add(VaultIndex, index))),
);
