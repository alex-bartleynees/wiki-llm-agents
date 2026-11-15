import { Data, Duration, Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { ProjectFilesError } from "./files.js";

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

/** git said no (a hook failed, the push was rejected, it took too long); `message` is git's own, for the user. */
export class GitRefused extends Data.TaggedError("GitRefused")<{ readonly message: string }> {}

/** How much of git's output a response carries: the end, where the reason is. */
const OUTPUT_CHARS = 8000;

export const COMMIT_TIMEOUT = Duration.minutes(5);
export const PUSH_TIMEOUT = Duration.seconds(90);
/** How long git gets to stop after SIGTERM before SIGKILL. */
const KILL_GRACE = Duration.seconds(5);

const tail = (text: string) => {
  const trimmed = text.trim();
  return trimmed.length <= OUTPUT_CHARS ? trimmed : `…${trimmed.slice(-OUTPUT_CHARS)}`;
};

/** git's message without its `fatal:`/`error:` prefixes. */
const gitMessage = (text: string, fallback: string) => tail(text).replace(/^(fatal|error): /gm, "") || fallback;

type WriteResult = { readonly _tag: "Exited"; readonly code: number; readonly output: string } | { readonly _tag: "TimedOut"; readonly output: string };

interface WriteOptions {
  /** Written to git's stdin (a commit message); none gives git an empty stdin. */
  readonly input?: string;
  readonly timeout: Duration.Duration;
  /** `GIT_SSH_COMMAND` for this run. */
  readonly ssh?: string;
}

const failed = (args: ReadonlyArray<string>) => (cause: unknown) => new ProjectFilesError({ message: `Could not run git ${args[0]}`, cause });

/**
 * Runs git in `directory` and gives its exit code with stdout and stderr together, in
 * the order they came (only the end is kept), or `TimedOut` with what it printed so far.
 */
const write = (directory: string, args: ReadonlyArray<string>, options: WriteOptions) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const command = ChildProcess.make("git", ["--no-pager", "--literal-pathspecs", "-C", directory, ...args], {
      env: {
        GIT_TERMINAL_PROMPT: "0",
        GIT_EDITOR: ":",
        GCM_INTERACTIVE: "never",
        SSH_ASKPASS_REQUIRE: "never",
        LC_ALL: "C",
        ...(options.ssh === undefined ? {} : { GIT_SSH_COMMAND: options.ssh }),
      },
      extendEnv: true,
      detached: true,
      stdin: options.input === undefined ? "ignore" : Stream.succeed(new TextEncoder().encode(options.input)),
      stdout: "pipe",
      stderr: "pipe",
      killSignal: "SIGTERM",
      forceKillAfter: KILL_GRACE,
    });
    // Kept outside the scope, so a timeout still has what git printed.
    let output = "";
    const run = Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(command);
        const [, code] = yield* Effect.all(
          [
            handle.all.pipe(
              Stream.decodeText(),
              Stream.runForEach((chunk) =>
                Effect.sync(() => {
                  output += chunk;
                  // Only the end is ever shown; don't hold a chatty hook's whole output.
                  if (output.length > OUTPUT_CHARS * 4) output = output.slice(-OUTPUT_CHARS * 2);
                }),
              ),
            ),
            handle.exitCode,
          ],
          { concurrency: 2 },
        );
        return { _tag: "Exited", code: Number(code), output } satisfies WriteResult;
      }),
    );
    return yield* run.pipe(
      Effect.mapError(failed(args)),
      Effect.timeoutOrElse({ duration: options.timeout, orElse: () => Effect.succeed({ _tag: "TimedOut", output } satisfies WriteResult) }),
    );
  });

/** Runs git and fails with `GitRefused` (git's message, or the time limit) unless it exits 0; gives its output. */
const succeed = (directory: string, args: ReadonlyArray<string>, options: WriteOptions) =>
  Effect.flatMap(write(directory, args, options), (result) =>
    result._tag === "Exited" && result.code === 0
      ? Effect.succeed(tail(result.output))
      : Effect.fail(
          new GitRefused({
            message:
              result._tag === "TimedOut"
                ? `git ${args[0]} took longer than ${Duration.format(options.timeout)} and was stopped.${result.output.trim() === "" ? "" : `\n${tail(result.output)}`}`
                : gitMessage(result.output, `git ${args[0]} failed (exit ${result.code})`),
          }),
        ),
  );

/** A setting from git's config for `directory`, or null when it isn't set. */
const configValue = (directory: string, key: string) =>
  Effect.map(write(directory, ["config", "--get", key], { timeout: COMMIT_TIMEOUT }), (result) =>
    result._tag === "Exited" && result.code === 0 && result.output.trim() !== "" ? result.output.trim() : null,
  );

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
export const addPaths = (directory: string, paths: ReadonlyArray<string>) =>
  paths.length === 0 ? Effect.void : Effect.asVoid(succeed(directory, ["add", "--", ...paths], { timeout: COMMIT_TIMEOUT }));

/** Takes paths `addPaths` added back out of the index (after a failed commit), leaving the files alone. */
export const unstagePaths = (directory: string, paths: ReadonlyArray<string>) =>
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
export const describeCommit = (directory: string, commit: string) =>
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
