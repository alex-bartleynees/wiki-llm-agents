import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Configured providers. Per-account state belongs to an instance, not to a kind. */
export const providerInstances = sqliteTable("provider_instances", {
  id: text("id").primaryKey(),
  /** Which adapter runs it: `opencode`, `claude-code`, `codex` or `replay`. */
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  /** Adapter settings as JSON (binary path, model...). */
  settings: text("settings").notNull().default("{}"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
