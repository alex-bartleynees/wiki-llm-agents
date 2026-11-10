import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Json } from "../../shared/markdown/syntax.js";

/*
 * The vault index: derived from the files on disk, so it can be dropped and rebuilt
 * at any time. Full-text search lives in the `notes_fts` FTS5 table, created by a
 * custom migration because Drizzle can't declare virtual tables.
 */

/** Every visible file in each vault (notes, pages, images...), for the tree and link resolution. */
export const vaultFiles = sqliteTable(
  "vault_files",
  {
    vaultId: text("vault_id").notNull(),
    path: text("path").notNull(),
    kind: text("kind", { enum: ["note", "page", "json", "file"] }).notNull(),
    mtimeMs: integer("mtime_ms").notNull(),
    size: integer("size").notNull(),
  },
  (table) => [primaryKey({ columns: [table.vaultId, table.path] })],
);

/** Markdown notes: what was read from the file the last time it changed. */
export const notes = sqliteTable(
  "notes",
  {
    vaultId: text("vault_id").notNull(),
    path: text("path").notNull(),
    title: text("title").notNull(),
    frontmatter: text("frontmatter", { mode: "json" }).$type<Readonly<Record<string, Json>>>().notNull(),
    tags: text("tags", { mode: "json" }).$type<ReadonlyArray<string>>().notNull(),
    contentHash: text("content_hash").notNull(),
  },
  (table) => [primaryKey({ columns: [table.vaultId, table.path] }), index("notes_content_hash").on(table.contentHash)],
);

/** Note contents by SHA-256, shared by identical versions; change review (slice 9) keeps old ones. */
export const blobs = sqliteTable("blobs", {
  hash: text("hash").primaryKey(),
  content: text("content").notNull(),
});

/** Links from notes, as written, and what they resolve to now (null when unresolved). */
export const links = sqliteTable(
  "links",
  {
    vaultId: text("vault_id").notNull(),
    srcPath: text("src_path").notNull(),
    kind: text("kind", { enum: ["wikilink", "embed", "markdown"] }).notNull(),
    target: text("target").notNull(),
    targetPath: text("target_path"),
  },
  (table) => [
    primaryKey({ columns: [table.vaultId, table.srcPath, table.kind, table.target] }),
    index("links_target").on(table.vaultId, table.targetPath),
  ],
);
