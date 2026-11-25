import type { IgnoredFile, Project, Worktree } from "@wiki-agents/contracts/projects/model";
import { Effect } from "effect";
import { InvalidProject } from "./errors.js";
import { isInsidePath } from "./paths.js";
import { mainDirectory } from "./project-context.js";

/**
 * The file, when it names a path inside one of the project's working directories or
 * a thread's worktree. A worktree has the main directory's list (same relative
 * paths), so a file there is kept against the main directory.
 */
export const checkIgnoredFile = (project: Project, file: IgnoredFile, worktrees: ReadonlyArray<Worktree> = []): Effect.Effect<IgnoredFile, InvalidProject> => {
  const directory = worktrees.some((worktree) => worktree.directory === file.directory) ? mainDirectory(project) : file.directory;
  return !project.workingDirectories.includes(directory)
    ? Effect.fail(new InvalidProject({ message: "Not one of the project's working directories" }))
    : !isInsidePath(file.path)
      ? Effect.fail(new InvalidProject({ message: "The path must be relative and inside the working directory" }))
      : Effect.succeed({ directory, path: file.path });
};
