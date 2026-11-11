import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** A project: its working directories (main directory first) and the shared vault it uses. */
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  vaultId: text("vault_id").notNull(),
  /** Canonical paths on this machine. */
  workingDirectories: text("working_directories", { mode: "json" }).$type<ReadonlyArray<string>>().notNull(),
  notesFolder: text("notes_folder"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * The baseline the changed-file list compares with: every file's hash when the project
 * was registered or its changes were last marked reviewed. Machine-local, like the paths.
 */
export const projectFiles = sqliteTable(
  "project_files",
  {
    projectId: text("project_id").notNull(),
    directory: text("directory").notNull(),
    path: text("path").notNull(),
    hash: text("hash").notNull(),
    size: integer("size"),
    /** Milliseconds since the epoch, with the file system's fraction. */
    modifiedAt: real("modified_at"),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.directory, table.path] })],
);
