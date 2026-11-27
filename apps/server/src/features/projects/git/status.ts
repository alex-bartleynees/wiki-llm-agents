import { Effect } from "effect";
import { isWorkTree, output, runGit as run } from "./process.js";

export const workTrees = (directories: ReadonlyArray<string>) =>
  Effect.forEach(directories, isWorkTree, { concurrency: 16 });

export const headCommit = (directory: string) =>
  Effect.map(run(directory, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]), (result) => (result.code === 0 ? result.stdout.trim() : null));

export const recentSubjects = (directory: string, count: number) =>
  Effect.map(run(directory, ["log", `-${count}`, "--no-color", "--format=%s"]), (result) =>
    result.code === 0 ? result.stdout.split("\n").filter((line) => line.trim() !== "") : [],
  );

const CONFIG_PATTERN = "^(remote\\.pushdefault|remote\\..+\\.(url|fetch|pushurl)|branch\\..+\\.(remote|merge))$";

export interface BranchStatus {
  readonly branch: string | null;
  readonly head: string | null;
  readonly upstream: { readonly remote: string; readonly branch: string } | null;
  readonly ahead: number | null;
  readonly behind: number | null;
  readonly pushRemote: string | null;
  readonly remotes: ReadonlyArray<string>;
}

export const parseBranchStatus = (statusStdout: string, configStdout: string): BranchStatus => {
  let branch: string | null = null;
  let head: string | null = null;
  let abAhead: number | null = null;
  let abBehind: number | null = null;

  for (const line of statusStdout.split("\n")) {
    if (!line.startsWith("# ")) break;
    if (line.startsWith("# branch.oid ")) {
      const value = line.slice("# branch.oid ".length).trim();
      head = value === "(initial)" || value === "" ? null : value;
    } else if (line.startsWith("# branch.head ")) {
      const value = line.slice("# branch.head ".length).trim();
      branch = value === "(detached)" || value === "" ? null : value;
    } else if (line.startsWith("# branch.ab ")) {
      const match = /^\+(\d+)\s+-(\d+)/.exec(line.slice("# branch.ab ".length).trim());
      if (match !== null) {
        abAhead = Number(match[1]);
        abBehind = Number(match[2]);
      }
    }
  }

  let pushDefault: string | null = null;
  const remoteSet = new Set<string>();
  const branchRemote = new Map<string, string>();
  const branchMerge = new Map<string, string>();

  for (const entry of configStdout.split("\0")) {
    if (entry === "") continue;
    const nl = entry.indexOf("\n");
    const key = nl === -1 ? entry : entry.slice(0, nl);
    const value = nl === -1 ? "" : entry.slice(nl + 1).trim();
    if (key === "remote.pushdefault") {
      pushDefault = value === "" ? null : value;
    } else if (key.startsWith("remote.")) {
      const rest = key.slice("remote.".length);
      const lastDot = rest.lastIndexOf(".");
      if (lastDot > 0) {
        const suffix = rest.slice(lastDot + 1);
        if (suffix === "url" || suffix === "fetch" || suffix === "pushurl") {
          remoteSet.add(rest.slice(0, lastDot));
        }
      }
    } else if (key.startsWith("branch.")) {
      const rest = key.slice("branch.".length);
      const lastDot = rest.lastIndexOf(".");
      if (lastDot > 0) {
        const name = rest.slice(0, lastDot);
        const field = rest.slice(lastDot + 1);
        if (field === "remote") branchRemote.set(name, value);
        else if (field === "merge") branchMerge.set(name, value);
      }
    }
  }

  const remotes = [...remoteSet];
  const pushRemote =
    pushDefault !== null && remotes.includes(pushDefault)
      ? pushDefault
      : remotes.includes("origin")
        ? "origin"
        : remotes.length === 1
          ? remotes[0]!
          : null;

  let upstream: { readonly remote: string; readonly branch: string } | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;
  if (branch !== null) {
    const remote = branchRemote.get(branch) ?? null;
    const merge = branchMerge.get(branch) ?? null;
    if (remote !== null && remote !== "" && remote !== "." && merge !== null && merge.startsWith("refs/heads/")) {
      upstream = { remote, branch: merge.slice("refs/heads/".length) };
      if (head !== null && abAhead !== null && abBehind !== null) {
        ahead = abAhead;
        behind = abBehind;
      }
    }
  }

  return { branch, head, upstream, ahead, behind, pushRemote, remotes };
};

export const branchStatus = Effect.fnUntraced(function* (directory: string) {
  const [statusStdout, config] = yield* Effect.all(
    [
      output(directory, ["status", "--porcelain=v2", "--branch", "--untracked-files=no"]),
      run(directory, ["config", "--null", "--get-regexp", CONFIG_PATTERN]),
    ],
    { concurrency: 2 },
  );
  return parseBranchStatus(statusStdout, config.code === 0 ? config.stdout : "");
});
