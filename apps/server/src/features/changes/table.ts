import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Notes a turn changed in its vault, one row per turn and path: the content hash
 * before the turn's first change and after its last (both in the index's `blobs`,
 * which keeps every hash referenced here). Created files have no `before_hash`,
 * deleted ones no `after_hash`. A file changed and changed back has no row.
 */
export const fileChanges = sqliteTable(
  "file_changes",
  {
    id: text("id").primaryKey(),
    vaultId: text("vault_id").notNull(),
    threadId: text("thread_id").notNull(),
    turnId: text("turn_id").notNull(),
    path: text("path").notNull(),
    beforeHash: text("before_hash"),
    afterHash: text("after_hash"),
    attribution: text("attribution", { enum: ["agent", "uncertain"] }).notNull(),
    /** The thread's agent id, or its provider instance when it has no agent. */
    actor: text("actor").notNull(),
    /** When the turn last changed the file. */
    recordedAt: integer("recorded_at", { mode: "timestamp_ms" }).notNull(),
    undoneAt: integer("undone_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("file_changes_turn_idx").on(table.turnId), index("file_changes_path_idx").on(table.vaultId, table.path)],
);
