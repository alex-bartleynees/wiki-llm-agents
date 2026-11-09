import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Files pinned in each vault, listed in the order they were pinned (rowid). Kept by
 * path: a pin to a file that is moved or deleted stays, shown as missing, until it
 * is unpinned.
 */
export const pins = sqliteTable(
  "pins",
  {
    vaultId: text("vault_id").notNull(),
    path: text("path").notNull(),
    pinnedAt: integer("pinned_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.vaultId, table.path] })],
);
