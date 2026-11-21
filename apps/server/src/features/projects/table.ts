import type { BrowserSignIn } from "@wiki-agents/contracts/projects/model";
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

/**
 * Threads' own git worktrees (see `worktrees.ts`). Kept after removal, so a thread
 * whose worktree is gone can say so instead of running in the main directory.
 */
export const projectWorktrees = sqliteTable("project_worktrees", {
  /** One worktree per thread at most. */
  threadId: text("thread_id").primaryKey(),
  projectId: text("project_id").notNull(),
  branch: text("branch").notNull(),
  /** The worktree's root, canonical, under the data directory. */
  path: text("path").notNull(),
  /** Where the thread works: `path`, or the folder in it matching the main directory. */
  directory: text("directory").notNull(),
  createdAt: integer("created_at").notNull(),
  /** Milliseconds since the epoch; null until the app removes it. */
  removedAt: integer("removed_at"),
  removedBranchIdentity: text("removed_branch_identity"),
  branchDeletedAt: integer("branch_deleted_at"),
});

/**
 * Threads that work in another thread's worktree: a thread continued in a new thread
 * that kept the same folder. The worktree stays the owner's record (`project_worktrees`);
 * removing it, from either thread, removes it for both.
 */
export const threadWorktreeShares = sqliteTable("thread_worktree_shares", {
  threadId: text("thread_id").primaryKey(),
  /** The thread whose worktree it is (`project_worktrees.thread_id`). */
  ownerThreadId: text("owner_thread_id").notNull(),
});

/**
 * One row (`id` "default"): which provider and model write **Suggest message** in the
 * Diff view. Null provider: Claude Code on Haiku when it is ready, else the first
 * provider with its default model.
 */
export const commitMessageSettings = sqliteTable("commit_message_settings", {
  id: text("id").primaryKey(),
  providerInstanceId: text("provider_instance_id"),
  /** Null for the provider's default (or Haiku, for the default Claude Code). */
  model: text("model"),
});

/**
 * Each project's browser sign-ins (`BrowserSignIn`), as one list in the order you gave
 * them: test accounts for local apps, by secret name, never a value.
 */
export const projectBrowserSignIns = sqliteTable("project_browser_sign_ins", {
  projectId: text("project_id").primaryKey(),
  signIns: text("sign_ins", { mode: "json" }).$type<ReadonlyArray<BrowserSignIn>>().notNull(),
});

/**
 * Each project's MCP servers (ids, as in `mcp/<id>.yaml`), in the order you gave them:
 * every thread in the project gets their tools, whatever its agent.
 */
export const projectMcpServers = sqliteTable("project_mcp_servers", {
  projectId: text("project_id").primaryKey(),
  serverIds: text("server_ids", { mode: "json" }).$type<ReadonlyArray<string>>().notNull(),
});
