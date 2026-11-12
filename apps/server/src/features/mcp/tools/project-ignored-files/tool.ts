import { Effect, Option, Schema } from "effect";
import { Tool } from "effect/ai";
import { ProjectRepository } from "../../../projects/repository.js";
import { ThreadRepository } from "../../../threads/repository.js";
import { VaultCaller } from "../../auth.js";
import { Notices, ToolFailure, vaultTool } from "../shared.js";

export const NOT_IN_A_PROJECT = "This thread isn't in a project, so no files are ignored.";

export const ProjectIgnoredFiles = vaultTool(
  Tool.make("project_ignored_files", {
    description:
      "Files the user sets aside in this project's diff review: changes they keep locally and never merge, such as local config. Call it before staging or committing, and leave these files out unless the user names them.",
    success: Schema.Struct({
      /** The project's name; null when the thread isn't in one. */
      project: Schema.NullOr(Schema.String),
      files: Schema.Array(
        Schema.Struct({
          directory: Schema.String.annotate({ description: "One of the project's working directories (an absolute path)." }),
          path: Schema.String.annotate({ description: "Relative to `directory`, with `/` separators." }),
        }),
      ),
      notices: Notices,
    }),
    failure: ToolFailure,
    dependencies: [VaultCaller],
  }),
);

/** The calling thread's project's ignored files, read when asked so the list is current. */
export const projectIgnoredFiles = Effect.fnUntraced(
  function* () {
    const { threadId } = yield* VaultCaller;
    const thread = yield* (yield* ThreadRepository).find(threadId);
    const projectId = Option.getOrNull(Option.flatMapNullishOr(thread, (summary) => summary.projectId));
    if (projectId === null) return { project: null, files: [], notices: [NOT_IN_A_PROJECT] };
    const projects = yield* ProjectRepository;
    const project = yield* projects.find(projectId);
    if (Option.isNone(project)) return { project: null, files: [], notices: [NOT_IN_A_PROJECT] };
    const files = yield* projects.ignoredFiles(projectId);
    return {
      project: project.value.name,
      files: files.map((file) => ({ directory: file.directory, path: file.path })),
      notices: files.length === 0 ? ["The user ignores no files in this project."] : [],
    };
  },
  Effect.catchTags({ DbError: () => Effect.fail(new ToolFailure({ message: "The project's ignored files couldn't be read just now." })) }),
);
