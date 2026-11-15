import type { Project, Worktree } from "@wiki-agents/contracts/projects/model";
import { Context, type Effect, type Option } from "effect";
import type { DbError } from "../../shared/persistence/errors.js";

/**
 * A file in a working directory and its SHA-256. With the size and modification time
 * matching, a rescan trusts the hash without reading the file; `modifiedAt` is null
 * when that isn't safe (recorded before it was kept, or written just before a scan).
 */
export interface FileVersion {
  readonly directory: string;
  readonly path: string;
  readonly hash: string;
  readonly size: number | null;
  readonly modifiedAt: number | null;
}

/** Which provider and model suggest commit messages; nulls for the defaults. */
export interface CommitMessageSettings {
  readonly providerInstanceId: string | null;
  readonly model: string | null;
}

/** A file left out of the diff review by default. */
export interface IgnoredFile {
  readonly directory: string;
  readonly path: string;
}

export interface ProjectRepositoryService {
  /** By name. */
  readonly list: Effect.Effect<ReadonlyArray<Project>, DbError>;
  readonly find: (id: string) => Effect.Effect<Option.Option<Project>, DbError>;
  readonly insert: (project: Project, baseline: ReadonlyArray<FileVersion>, at: number) => Effect.Effect<void, DbError>;
  /** Archives the project at `at`, or restores it with null. */
  readonly setArchivedAt: (id: string, at: number | null) => Effect.Effect<void, DbError>;
  /** The files the changed-file list compares with. */
  readonly baseline: (id: string) => Effect.Effect<ReadonlyArray<FileVersion>, DbError>;
  readonly replaceBaseline: (id: string, baseline: ReadonlyArray<FileVersion>) => Effect.Effect<void, DbError>;
  /** Files ignored in the diff review, in the order they were ignored. */
  readonly ignoredFiles: (id: string) => Effect.Effect<ReadonlyArray<IgnoredFile>, DbError>;
  /** Ignoring an ignored file changes nothing. */
  readonly ignoreFile: (id: string, file: IgnoredFile, at: number) => Effect.Effect<void, DbError>;
  readonly unignoreFile: (id: string, file: IgnoredFile) => Effect.Effect<void, DbError>;
  readonly insertWorktree: (worktree: Worktree) => Effect.Effect<void, DbError>;
  /** The project's worktrees, oldest first, removed ones included. */
  readonly worktrees: (projectId: string) => Effect.Effect<ReadonlyArray<Worktree>, DbError>;
  readonly worktreeOfThread: (threadId: string) => Effect.Effect<Option.Option<Worktree>, DbError>;
  readonly setWorktreeRemoved: (threadId: string, at: number) => Effect.Effect<void, DbError>;
  /** Forgets a worktree undone because its thread couldn't be saved. */
  readonly deleteWorktree: (threadId: string) => Effect.Effect<void, DbError>;
  /** Both null until saved. */
  readonly commitMessageSettings: Effect.Effect<CommitMessageSettings, DbError>;
  readonly saveCommitMessageSettings: (settings: CommitMessageSettings) => Effect.Effect<void, DbError>;
}

export class ProjectRepository extends Context.Service<ProjectRepository, ProjectRepositoryService>()("ProjectRepository") {}
