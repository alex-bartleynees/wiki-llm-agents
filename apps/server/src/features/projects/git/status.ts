import { Effect } from "effect";
import { configValue, isWorkTree, output, runGit as run } from "./process.js";

/** Whether each directory is in a git work tree, in order. */
export const workTrees = (directories: ReadonlyArray<string>) =>
  Effect.forEach(directories, isWorkTree, { concurrency: 16 });

/** `directory`'s current commit, or null before the first one. */
export const headCommit = (directory: string) =>
  Effect.map(run(directory, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]), (result) => (result.code === 0 ? result.stdout.trim() : null));

/** The subjects of the last `count` commits on `HEAD`, newest first; none before the first commit. */
export const recentSubjects = (directory: string, count: number) =>
  Effect.map(run(directory, ["log", `-${count}`, "--no-color", "--format=%s"]), (result) =>
    result.code === 0 ? result.stdout.split("\n").filter((line) => line.trim() !== "") : [],
  );

/** The remotes git knows in `directory`'s repository. */
const remotesOf = (directory: string) => Effect.map(output(directory, ["remote"]), (listed) => listed.split("\n").filter((name) => name !== ""));

/**
 * The branch, its upstream (`branch.<name>.remote` and `.merge`; a local upstream,
 * remote `.`, counts as none) and ahead/behind from the remote-tracking branch, as of
 * the last fetch. Never fetches.
 */
export const branchStatus = Effect.fnUntraced(function* (directory: string) {
  const symbolic = yield* run(directory, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const branch = symbolic.code === 0 ? symbolic.stdout.trim() : null;
  const head = yield* headCommit(directory);
  const remotes = yield* remotesOf(directory);
  const pushDefault = yield* configValue(directory, "remote.pushDefault");
  const pushRemote =
    pushDefault !== null && remotes.includes(pushDefault) ? pushDefault : remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0]! : null;
  let upstream: { readonly remote: string; readonly branch: string } | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;
  if (branch !== null) {
    const remote = yield* configValue(directory, `branch.${branch}.remote`);
    const merge = yield* configValue(directory, `branch.${branch}.merge`);
    if (remote !== null && remote !== "." && merge !== null && merge.startsWith("refs/heads/")) {
      upstream = { remote, branch: merge.slice("refs/heads/".length) };
      const counts = head === null ? null : yield* run(directory, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
      const match = counts?.code === 0 ? /^(\d+)\s+(\d+)/.exec(counts.stdout.trim()) : null;
      if (match !== null) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
    }
  }
  return { branch, head, upstream, ahead, behind, pushRemote, remotes };
});
