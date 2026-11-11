import { posix } from "node:path";
import type { TagCount } from "@wiki-agents/contracts/search/list-tags/response";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, ne, notInArray, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DbError } from "../../shared/persistence/errors.js";
import { Sqlite } from "../../shared/persistence/sqlite.js";
import { fileChanges } from "../changes/table.js";
import { searchNotes } from "./sqlite-search.js";
import { IndexStore } from "./store.js";
import { blobs, links, notes, vaultFiles } from "./table.js";
import { type NoteEdge, VaultIndex } from "./vault-index.js";

/** SQLite allows 32766 bound parameters; stay well below it. */
const CHUNK = 500;
const chunks = <A>(items: ReadonlyArray<A>): Array<ReadonlyArray<A>> =>
  Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, index) => items.slice(index * CHUNK, (index + 1) * CHUNK));

/** One adapter for both ports, over the shared connection. */
const make = Effect.gen(function* () {
  const { db } = yield* Sqlite;
  const query = <A>(run: () => A) => Effect.try({ try: run, catch: (cause) => new DbError({ cause }) });
  const transaction = <A>(run: () => A) => query(() => db.transaction(run));

  /**
   * Deletes blobs whose hash no note refers to any more, nor any recorded change
   * (change review needs the versions before and after a turn for diffs and undo).
   */
  const pruneBlobs = (hashes: ReadonlyArray<string>) => {
    for (const batch of chunks([...new Set(hashes)])) {
      db.delete(blobs)
        .where(
          and(
            inArray(blobs.hash, batch),
            notInArray(blobs.hash, db.select({ hash: notes.contentHash }).from(notes)),
            notInArray(blobs.hash, db.select({ hash: fileChanges.beforeHash }).from(fileChanges).where(isNotNull(fileChanges.beforeHash))),
            notInArray(blobs.hash, db.select({ hash: fileChanges.afterHash }).from(fileChanges).where(isNotNull(fileChanges.afterHash))),
          ),
        )
        .run();
    }
  };

  const hashesOf = (vaultId: string, paths: ReadonlyArray<string>) =>
    chunks(paths).flatMap((batch) =>
      db
        .select({ hash: notes.contentHash })
        .from(notes)
        .where(and(eq(notes.vaultId, vaultId), inArray(notes.path, batch)))
        .all()
        .map((row) => row.hash),
    );

  const removePaths = (vaultId: string, paths: ReadonlyArray<string>) => {
    const oldHashes = hashesOf(vaultId, paths);
    for (const batch of chunks(paths)) {
      db.delete(vaultFiles).where(and(eq(vaultFiles.vaultId, vaultId), inArray(vaultFiles.path, batch))).run();
      db.delete(notes).where(and(eq(notes.vaultId, vaultId), inArray(notes.path, batch))).run();
      db.delete(links).where(and(eq(links.vaultId, vaultId), inArray(links.srcPath, batch))).run();
      db.run(sql`DELETE FROM notes_fts WHERE vault_id = ${vaultId} AND path IN (${sql.join(batch.map((path) => sql`${path}`), sql`, `)})`);
    }
    pruneBlobs(oldHashes);
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

    putFile: (vaultId, file) =>
      query(() => {
        db.insert(vaultFiles)
          .values({ vaultId, ...file })
          .onConflictDoUpdate({
            target: [vaultFiles.vaultId, vaultFiles.path],
            set: { kind: file.kind, mtimeMs: file.mtimeMs, size: file.size },
          })
          .run();
      }),

    putNote: (vaultId, file, note) =>
      transaction(() => {
        const oldHashes = hashesOf(vaultId, [file.path]);
        db.insert(blobs).values({ hash: note.contentHash, content: note.content }).onConflictDoNothing().run();
        db.insert(vaultFiles)
          .values({ vaultId, ...file })
          .onConflictDoUpdate({
            target: [vaultFiles.vaultId, vaultFiles.path],
            set: { kind: file.kind, mtimeMs: file.mtimeMs, size: file.size },
          })
          .run();
        const row = { title: note.title, frontmatter: note.frontmatter, tags: note.tags, contentHash: note.contentHash };
        db.insert(notes)
          .values({ vaultId, path: file.path, ...row })
          .onConflictDoUpdate({ target: [notes.vaultId, notes.path], set: row })
          .run();
        db.delete(links).where(and(eq(links.vaultId, vaultId), eq(links.srcPath, file.path))).run();
        if (note.links.length > 0) {
          db.insert(links)
            .values(note.links.map((link) => ({ vaultId, srcPath: file.path, kind: link.kind, target: link.target, targetPath: null })))
            .run();
        }
        db.run(sql`DELETE FROM notes_fts WHERE vault_id = ${vaultId} AND path = ${file.path}`);
        db.run(
          sql`INSERT INTO notes_fts (vault_id, path, title, body, tags) VALUES (${vaultId}, ${file.path}, ${note.title}, ${note.body}, ${note.tags.join(" ")})`,
        );
        pruneBlobs(oldHashes.filter((hash) => hash !== note.contentHash));
      }),

    remove: (vaultId, paths) => (paths.length === 0 ? Effect.void : transaction(() => removePaths(vaultId, paths))),

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
          }),

    clear: (vaultId) =>
      transaction(() => {
        const paths = db.select({ path: vaultFiles.path }).from(vaultFiles).where(eq(vaultFiles.vaultId, vaultId)).all();
        removePaths(
          vaultId,
          paths.map((row) => row.path),
        );
      }),
  });

  const index = VaultIndex.of({
    files: (vaultId) =>
      query(() =>
        db
          .select({ path: vaultFiles.path, kind: vaultFiles.kind, mtimeMs: vaultFiles.mtimeMs, size: vaultFiles.size })
          .from(vaultFiles)
          .where(eq(vaultFiles.vaultId, vaultId))
          .all()
          // Same order as the vault walker (locale-aware, not SQLite's byte order).
          .sort((a, b) => a.path.localeCompare(b.path)),
      ),

    titledFiles: (vaultId) =>
      query(() =>
        db
          .select({ path: vaultFiles.path, kind: vaultFiles.kind, title: notes.title })
          .from(vaultFiles)
          .leftJoin(notes, and(eq(notes.vaultId, vaultFiles.vaultId), eq(notes.path, vaultFiles.path)))
          .where(eq(vaultFiles.vaultId, vaultId))
          .all()
          .map((row) => ({ ...row, title: row.title ?? posix.basename(row.path) })),
      ),

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
      query(() =>
        db.all<TagCount>(
          sql`SELECT t.value AS tag, count(*) AS count
              FROM notes, json_each(notes.tags) AS t
              WHERE notes.vault_id = ${vaultId} AND t.type = 'text'
              GROUP BY t.value
              ORDER BY count DESC, t.value COLLATE NOCASE`,
        ),
      ),

    neighbours: (vaultId, paths) =>
      query(() => {
        const edges = new Map<string, NoteEdge>();
        for (const batch of chunks([...new Set(paths)])) {
          const rows = db
            .selectDistinct({ from: links.srcPath, to: links.targetPath })
            .from(links)
            .innerJoin(notes, and(eq(notes.vaultId, links.vaultId), eq(notes.path, links.targetPath)))
            .where(
              and(
                eq(links.vaultId, vaultId),
                ne(links.kind, "embed"),
                ne(links.srcPath, links.targetPath),
                or(inArray(links.srcPath, batch), inArray(links.targetPath, batch)),
              ),
            )
            .all();
          for (const row of rows) if (row.to !== null) edges.set(`${row.from}\0${row.to}`, { from: row.from, to: row.to });
        }
        return [...edges.values()];
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

    recentFiles: (vaultId, { since, limit }) =>
      query(() => {
        const rows = db
          .select({ path: vaultFiles.path, kind: vaultFiles.kind, title: notes.title, modifiedAt: vaultFiles.mtimeMs })
          .from(vaultFiles)
          .leftJoin(notes, and(eq(notes.vaultId, vaultFiles.vaultId), eq(notes.path, vaultFiles.path)))
          .where(and(eq(vaultFiles.vaultId, vaultId), gte(vaultFiles.mtimeMs, since)))
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
