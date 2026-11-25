import { Duration, Effect } from "effect";
import { untrackedAmong } from "./diff.js";
import { GitRefused } from "./errors.js";
import { configValue, succeed } from "./process.js";
import { headCommit } from "./status.js";

/**
 * The commit and push the user starts from the Diff view (slice 14d): `git add` of new
 * files, `git commit --only` of exactly the ticked paths, and `git push` of the
 * current branch. Never `-a`, `--amend`, `--no-verify` or `--force`, never another
 * branch, never a pull, merge or restore.
 *
 * git runs through Effect's `ChildProcessSpawner`: no shell, literal pathspecs, every
 * prompt turned off, in its own session (`detached`: no controlling terminal, so ssh
 * can't ask for a passphrase there), within a scope. A time limit interrupts the run,
 * and closing the scope ends git's whole process group (hooks, ssh), escalating to
 * SIGKILL if it ignores SIGTERM. A missing credential fails with git's message
 * instead of hanging.
 */

const COMMIT_TIMEOUT = Duration.minutes(5);
const PUSH_TIMEOUT = Duration.seconds(90);

/**
 * The ssh command for pushes: the user's (`GIT_SSH_COMMAND`, else `core.sshCommand`,
 * else `ssh`) in batch mode, so a missing key or unknown host fails instead of asking.
 * Left alone when only `GIT_SSH` is set (a program, not a command line).
 */
const sshCommand = (directory: string) =>
  Effect.gen(function* () {
    const fromEnv = process.env.GIT_SSH_COMMAND;
    if (fromEnv !== undefined && fromEnv !== "") return `${fromEnv} -o BatchMode=yes`;
    const configured = yield* configValue(directory, "core.sshCommand");
    if (configured !== null) return `${configured} -o BatchMode=yes`;
    if (process.env.GIT_SSH !== undefined && process.env.GIT_SSH !== "") return undefined;
    return "ssh -o BatchMode=yes";
  });

/** `git add -- <paths>`: new files, so `commit --only` can take them. */
const addPaths = (directory: string, paths: ReadonlyArray<string>) =>
  paths.length === 0 ? Effect.void : Effect.asVoid(succeed(directory, ["add", "--", ...paths], { timeout: COMMIT_TIMEOUT }));

/** Takes paths `addPaths` added back out of the index (after a failed commit), leaving the files alone. */
const unstagePaths = (directory: string, paths: ReadonlyArray<string>) =>
  paths.length === 0
    ? Effect.void
    : succeed(directory, ["rm", "--cached", "--quiet", "--ignore-unmatch", "--", ...paths], { timeout: COMMIT_TIMEOUT }).pipe(
        Effect.asVoid,
        Effect.catch((error) => Effect.logWarning(`couldn't unstage ${paths.join(", ")} in ${directory}: ${error.message}`)),
      );

/**
 * `git commit --only -F - -- <paths>`: commits those paths as they are in the working
 * tree, and nothing else that is staged. Hooks run, within `timeout`. Returns git's output.
 */
export const commitPaths = (directory: string, paths: ReadonlyArray<string>, message: string, timeout: Duration.Duration = COMMIT_TIMEOUT) =>
  succeed(directory, ["commit", "--only", "--quiet", "-F", "-", "--", ...paths], { input: message, timeout });

/** The commit's hash, short hash and subject; just the hash if git can't say (the commit is made either way). */
const describeCommit = (directory: string, commit: string) =>
  succeed(directory, ["log", "-1", "--format=%H%x00%h%x00%s", commit], { timeout: COMMIT_TIMEOUT }).pipe(
    Effect.map((output) => {
      const [hash = commit, shortHash = commit.slice(0, 7), subject = ""] = output.split("\0");
      return { hash, shortHash, subject };
    }),
    Effect.catch(() => Effect.succeed({ hash: commit, shortHash: commit.slice(0, 7), subject: "" })),
  );

/**
 * `git push [-u] <remote> refs/heads/<branch>:refs/heads/<target>`: one branch, to the
 * named branch, never forced (no `+`, no `--force`).
 */
export const pushBranch = (directory: string, remote: string, branch: string, target: string, setUpstream: boolean) =>
  Effect.gen(function* () {
    const ssh = yield* sshCommand(directory);
    const args = ["push", ...(setUpstream ? ["-u"] : []), remote, `refs/heads/${branch}:refs/heads/${target}`];
    return yield* succeed(directory, args, { timeout: PUSH_TIMEOUT, ...(ssh === undefined ? {} : { ssh }) });
  });

export const commitExactly = Effect.fnUntraced(function* (directory: string, head: string | null, paths: ReadonlyArray<string>, message: string, skip: ReadonlySet<string>) {
  const added = yield* untrackedAmong(directory, paths, skip);
  yield* addPaths(directory, added);
  const output = yield* commitPaths(directory, paths, message).pipe(Effect.tapError(() => unstagePaths(directory, added)));
  const after = yield* headCommit(directory);
  if (after === null || after === head) return yield* new GitRefused({ message: "git finished without making a commit" });
  return { commit: yield* describeCommit(directory, after), output };
});
