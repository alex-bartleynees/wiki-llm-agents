import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Files sent with thread messages. The bytes live in the data folder at
 * `attachments/<sha256>/<name>`; the same bytes under the same name are one row.
 * Kept as long as the app is: nothing deletes them yet.
 */
export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    sha256: text("sha256").notNull(),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    kind: text("kind", { enum: ["image", "file"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("attachments_content_idx").on(table.sha256, table.name)],
);
