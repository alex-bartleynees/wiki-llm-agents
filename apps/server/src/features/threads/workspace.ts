import { Effect, Option } from "effect";
import { findProject } from "../projects/find-project.js";
import { threadDirectories } from "../projects/project-context.js";
import { threadWorktree } from "../projects/worktrees.js";
import { findVault } from "../vaults/find-vault.js";

/**
 * A thread's vault, its project (if any), its worktree (if it was made with one), its
 * working directories, and the folder its agent works in: the vault's root, the
 * project's main directory, or the thread's worktree. The one place that decides.
 */
export const threadWorkspace = Effect.fnUntraced(function* (thread: { readonly id: string; readonly vaultId: string; readonly projectId: string | null }) {
  const vault = yield* findVault(thread.vaultId);
  const project = thread.projectId === null ? null : yield* findProject(thread.projectId);
  const worktree = project === null ? null : Option.getOrNull(yield* threadWorktree(thread.id));
  const directories = project === null ? [] : threadDirectories(project, worktree);
  return { vault, project, worktree, directories, cwd: project === null ? vault.rootPath : directories[0]! };
});
