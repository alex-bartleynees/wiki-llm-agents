import type { IgnoredFile, Project } from "@wiki-agents/contracts/projects/model";
import { Effect } from "effect";
import { InvalidProject } from "./errors.js";
import { isInsidePath } from "./git-diff.js";

/** The file, when it names a path inside one of the project's working directories. */
export const checkIgnoredFile = (project: Project, file: IgnoredFile): Effect.Effect<IgnoredFile, InvalidProject> =>
  !project.workingDirectories.includes(file.directory)
    ? Effect.fail(new InvalidProject({ message: "Not one of the project's working directories" }))
    : !isInsidePath(file.path)
      ? Effect.fail(new InvalidProject({ message: "The path must be relative and inside the working directory" }))
      : Effect.succeed({ directory: file.directory, path: file.path });
