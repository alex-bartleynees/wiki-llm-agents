import { Effect } from "effect";
import { findProject } from "../projects/find-project.js";
import { mainDirectory } from "../projects/project-context.js";
import { findVault } from "../vaults/find-vault.js";

/** A thread's vault, its project (if any), and the folder its agent works in. */
export const threadWorkspace = Effect.fnUntraced(function* (thread: { readonly vaultId: string; readonly projectId: string | null }) {
  const vault = yield* findVault(thread.vaultId);
  const project = thread.projectId === null ? null : yield* findProject(thread.projectId);
  return { vault, project, cwd: project === null ? vault.rootPath : mainDirectory(project) };
});
