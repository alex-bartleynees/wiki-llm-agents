import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const vaults = sqliteTable("vaults", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  rootPath: text("root_path").notNull().unique(),
  /** Vault-relative folder of note templates; null: no templates. */
  templateFolder: text("template_folder"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
