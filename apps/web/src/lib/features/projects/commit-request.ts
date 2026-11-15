import type { CommitChangesRequest } from "@wiki-agents/contracts/projects/commit-changes/request";
import type { DiffFile, DirectoryDiff } from "@wiki-agents/contracts/projects/model";

/**
 * Whether a file goes into the commit: files in review are ticked unless you untick
 * them; ignored files are unticked unless you tick them.
 */
export const isTicked = (ticks: { readonly unticked: ReadonlySet<string>; readonly ticked: ReadonlySet<string> }, key: string, ignored: boolean) =>
  ignored ? ticks.ticked.has(key) : !ticks.unticked.has(key);

/**
 * The commit of `files` as `directory` showed them: its `HEAD`, each file's hash, and
 * a rename's old path (deleted) beside its new one, so git takes both sides.
 */
export const commitRequest = (directory: DirectoryDiff, files: ReadonlyArray<DiffFile>, message: string): CommitChangesRequest => ({
  directory: directory.directory,
  head: directory.head ?? null,
  message,
  files: files.flatMap((file) => [
    { path: file.path, hash: file.hash ?? null },
    ...(file.oldPath === null || files.some((other) => other.path === file.oldPath) ? [] : [{ path: file.oldPath, hash: null }]),
  ]),
});
