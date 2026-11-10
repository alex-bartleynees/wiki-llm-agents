import type { Project } from "@wiki-agents/contracts/projects/model";
import { Context, type Effect, type Option } from "effect";
import type { DbError } from "../../shared/persistence/errors.js";

/** A file in a working directory and its SHA-256. */
export interface FileVersion {
  readonly directory: string;
  readonly path: string;
  readonly hash: string;
}

export interface ProjectRepositoryService {
  /** By name. */
  readonly list: Effect.Effect<ReadonlyArray<Project>, DbError>;
  readonly find: (id: string) => Effect.Effect<Option.Option<Project>, DbError>;
  readonly insert: (project: Project, baseline: ReadonlyArray<FileVersion>, at: number) => Effect.Effect<void, DbError>;
  /** The files the changed-file list compares with. */
  readonly baseline: (id: string) => Effect.Effect<ReadonlyArray<FileVersion>, DbError>;
  readonly replaceBaseline: (id: string, baseline: ReadonlyArray<FileVersion>) => Effect.Effect<void, DbError>;
}

export class ProjectRepository extends Context.Service<ProjectRepository, ProjectRepositoryService>()("ProjectRepository") {}
