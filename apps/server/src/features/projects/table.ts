import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** A project: its working directories (main directory first) and the shared vault it uses. */
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  vaultId: text("vault_id").notNull(),
  /** Canonical paths on this machine. */
  workingDirectories: text("working_directories", { mode: "json" }).$type<ReadonlyArray<string>>().notNull(),
  notesFolder: text("notes_folder"),
  /** Milliseconds since the epoch; null while active. */
  archivedAt: integer("archived_at"),
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

/**
 * Files left out of the project's diff review by default, such as local config that
 * is never merged. Kept by path, whether or not the file has changes now, until the
 * user stops ignoring it.
 */
export const projectIgnoredFiles = sqliteTable(
  "project_ignored_files",
  {
    projectId: text("project_id").notNull(),
    directory: text("directory").notNull(),
    /** Relative to `directory`, with `/` separators. */
    path: text("path").notNull(),
    ignoredAt: integer("ignored_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.directory, table.path] })],
);
