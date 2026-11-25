import { createHash } from "node:crypto";
import { join } from "node:path";
import { Cause, Duration, Effect, FileSystem, Queue, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { preciseStat } from "../../../shared/node-files.js";
import { runGit, succeed } from "./process.js";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const oid = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const DELETE_TIMEOUT = "15 seconds";
const KILL_GRACE = "5 seconds";

export const repositoryIdentity = Effect.fnUntraced(function* (directory: string) {
  const common = yield* runGit(directory, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common.code !== 0) return null;
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.realPath(common.stdout.trim()).pipe(Effect.orElseSucceed(() => null));
});

export const inspectBranch = Effect.fnUntraced(function* (directory: string, ref: string, repository?: string) {
  const gitDir = repository === undefined ? [] : [`--git-dir=${repository}`];
  const result = yield* runGit(directory, [...gitDir, "for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)%00%(worktreepath)", "--", ref]);
  if (result.code !== 0) return { status: "unknown" } as const;
  // Git may also return refs below the specified prefix. Match the exact name.
  const row = result.stdout.split("\n").find((line) => line.startsWith(ref + "\0"));
  if (row === undefined) {
    const exists = yield* runGit(directory, [...gitDir, "show-ref", "--exists", ref]);
    return exists.code === 2 ? { status: "missing" } as const : { status: "unknown" } as const;
  }
  const [, tip, symbolic, occupied] = row.split("\0");
  if (!oid.test(tip ?? "") || symbolic !== "" || occupied === undefined) return { status: "unknown" } as const;
  return { status: "present", tip: tip!, occupied: occupied !== "" } as const;
});

export const branchIdentity = (repository: string, ref: string, tip: string) =>
  // A recreated branch can point at the same commit. Require its original reflog
  // file and contents as well as the tip. Repositories without that evidence fail closed.
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const log = join(repository, "logs", ref);
    const before = yield* preciseStat(log);
    const content = Buffer.from(yield* fs.readFile(log));
    const after = yield* preciseStat(log);
    if (before.ino !== after.ino || before.ctimeNs !== after.ctimeNs) return null;
    return digest([repository, ref, tip, String(after.dev), String(after.ino), String(after.birthtimeNs), String(after.ctimeNs), content.toString("base64")]);
  }).pipe(Effect.orElseSucceed(() => null));

export const captureRemovedBranch = Effect.fnUntraced(function* (directory: string, worktree: string, branch: string) {
  const ref = `refs/heads/${branch}`;
  const [repository, worktreeRepository, head, local] = yield* Effect.all(
    [
      repositoryIdentity(directory),
      repositoryIdentity(worktree),
      runGit(worktree, ["symbolic-ref", "--quiet", "HEAD"]),
      inspectBranch(directory, ref),
    ],
    { concurrency: "unbounded" },
  );
  if (repository === null || repository !== worktreeRepository || head.code !== 0 || head.stdout.trim() !== ref || local.status !== "present") return null;
  return yield* branchIdentity(repository, ref, local.tip);
});

const updateRef = Effect.fnUntraced(function* (directory: string, repository: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const input = yield* Queue.unbounded<string, Cause.Done>();
  const lines = yield* Queue.unbounded<string, Cause.Done>();
  const handle = yield* spawner.spawn(
    ChildProcess.make("git", ["--no-pager", "-C", directory, `--git-dir=${repository}`, "update-ref", "--no-deref", "--stdin"], {
      env: { LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
      extendEnv: true,
      detached: true,
      stdin: Stream.fromQueue(input).pipe(Stream.encodeText),
      stdout: "pipe",
      stderr: "ignore",
      forceKillAfter: KILL_GRACE,
    }),
  );
  yield* handle.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach((line) => Queue.offer(lines, line)),
    Effect.ensuring(Queue.end(lines)),
    Effect.forkScoped,
  );
  return {
    send: (text: string) => Queue.offer(input, text),
    replies: (line: string) => Queue.take(lines).pipe(Effect.map((reply) => reply === line), Effect.orElseSucceed(() => false)),
    finish: (text: string) =>
      Queue.offer(input, text).pipe(
        Effect.andThen(Queue.end(input)),
        Effect.andThen(handle.exitCode),
        Effect.map((code) => Number(code) === 0),
      ),
  };
});

/**
 * Git's worktreepath atom uses the same checked-out branch lookup as git branch,
 * including rebase and bisect. Recheck it after preparing the compare-and-delete
 * transaction, while both refs are locked. Git's checkout also has a window
 * between inspecting a ref and updating a worktree's HEAD.
 */
export const deleteVerifiedRef = (
  directory: string,
  repository: string,
  ref: string,
  tip: string,
  identity: string,
  target: string,
  targetTip: string,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const transaction = yield* updateRef(directory, repository);
      yield* transaction.send(`start\nverify ${target} ${targetTip}\ndelete ${ref} ${tip}\nprepare\n`);
      const prepared = (yield* transaction.replies("start: ok")) && (yield* transaction.replies("prepare: ok"));
      const local = prepared ? yield* inspectBranch(directory, ref, repository) : undefined;
      const verified = local?.status === "present" && !local.occupied && local.tip === tip && (yield* branchIdentity(repository, ref, tip)) === identity;
      const exited = yield* transaction.finish(verified ? "commit\n" : "abort\n");
      return verified && exited;
    }),
  ).pipe(
    Effect.timeoutOrElse({ duration: DELETE_TIMEOUT, orElse: () => Effect.succeed(false) }),
    Effect.orElseSucceed(() => false),
  );

const queryRemote = (directory: string, args: ReadonlyArray<string>) => succeed(directory, args, { timeout: Duration.seconds(20) });

const remoteTarget = Effect.fnUntraced(function* (directory: string) {
  const remotes = yield* runGit(directory, ["remote"]);
  if (remotes.code !== 0) return null;
  const names = remotes.stdout.trim().split("\n").filter(Boolean);
  const remote = names.includes("origin") ? "origin" : names.length === 1 ? names[0]! : null;
  if (remote === null || remote.startsWith("-")) return null;
  const url = yield* runGit(directory, ["remote", "get-url", "--", remote]);
  if (url.code !== 0) return null;
  const remoteUrl = url.stdout.trim();
  const advertised = yield* queryRemote(directory, ["ls-remote", "--symref", "--exit-code", "--", remote, "HEAD"]);
  const rows = advertised.split("\n");
  const ref = rows.find((row) => row.startsWith("ref: refs/heads/") && row.endsWith("\tHEAD"))?.slice(5, -5);
  const tip = rows.find((row) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})\t/.test(row) && row.endsWith("\tHEAD"))?.split("\t")[0];
  if (ref === undefined || tip === undefined || (yield* runGit(directory, ["check-ref-format", ref])).code !== 0) return null;
  const branch = ref.slice("refs/heads/".length);
  const tracking = `refs/remotes/${remote}/${branch}`;
  if ((yield* runGit(directory, ["check-ref-format", tracking])).code !== 0) return null;
  return { remote, remoteUrl, ref, tracking, tip, label: `${remote}/${branch}` };
});

export const fetchMergeTarget = (directory: string, excludedRef: string) =>
  Effect.gen(function* () {
    const target = yield* remoteTarget(directory);
    if (target === null || excludedRef === target.ref) return target;
    yield* queryRemote(directory, [
      "fetch", "--no-tags", "--no-prune", "--no-prune-tags", "--no-auto-maintenance", "--no-recurse-submodules", "--no-write-fetch-head",
      "--refmap=", "--", target.remote, `+${target.ref}:${target.tracking}`,
    ]);
    const fetched = yield* inspectBranch(directory, target.tracking);
    return fetched.status === "present" && fetched.tip === target.tip ? target : null;
  }).pipe(Effect.catch(() => Effect.succeed(null)));

export const isAncestor = (directory: string, tip: string, targetTip: string) =>
  Effect.map(
    runGit(directory, ["--no-replace-objects", "merge-base", "--is-ancestor", tip, targetTip], false, { GIT_GRAFT_FILE: "/dev/null" }),
    (result) => result.code === 0,
  );
