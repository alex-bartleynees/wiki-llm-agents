import { constants } from "node:buffer";
import { Duration, Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { GitFailed, GitRefused } from "./errors.js";

class OutputTooLong extends Error {}

const collect = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  Effect.gen(function* () {
    const chunks: Array<Uint8Array> = [];
    let length = 0;
    yield* Stream.runForEach(stream, (chunk) => {
      length += chunk.length;
      if (length > constants.MAX_STRING_LENGTH) return Effect.fail(new OutputTooLong());
      chunks.push(chunk);
      return Effect.void;
    });
    return Buffer.concat(chunks, length).toString("utf8");
  });

export interface GitResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export const runGit = (directory: string, args: ReadonlyArray<string>, literal = false, env: Record<string, string> = {}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const handle = yield* spawner.spawn(
        ChildProcess.make("git", ["--no-pager", ...(literal ? ["--literal-pathspecs"] : []), "-C", directory, ...args], {
          env: { GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C", ...env },
          extendEnv: true,
          detached: false,
          stdin: "ignore",
          forceKillAfter: "5 seconds",
        }),
      );
      const [stdout, stderr, code] = yield* Effect.all([collect(handle.stdout), collect(handle.stderr), handle.exitCode], { concurrency: "unbounded" });
      return { code: Number(code), stdout, stderr } satisfies GitResult;
    }),
  ).pipe(Effect.catch(() => Effect.succeed<GitResult>({ code: null, stdout: "", stderr: "" })));

export const isWorkTree = (directory: string) => Effect.map(runGit(directory, ["check-ignore", "-q", "."]), ({ code }) => code === 1);

/** Runs git and fails when it does. */
export const output = Effect.fnUntraced(function* (directory: string, args: ReadonlyArray<string>, literal = false) {
  const result = yield* runGit(directory, args, literal);
  if (result.code !== 0) {
    return yield* new GitFailed({ message: `git ${args[0]} failed in ${directory}: ${result.stderr.trim() || `exit ${result.code}`}` });
  }
  return result.stdout;
});

export const configValue = (directory: string, key: string) =>
  Effect.map(runGit(directory, ["config", "--get", key]), (result) => (result.code === 0 && result.stdout.trim() !== "" ? result.stdout.trim() : null));

/** How much of git's output a response carries: the end, where the reason is. */
const OUTPUT_CHARS = 8000;
/** How long git gets to stop after SIGTERM before SIGKILL. */
const KILL_GRACE = Duration.seconds(5);

const tail = (text: string) => {
  const trimmed = text.trim();
  return trimmed.length <= OUTPUT_CHARS ? trimmed : `…${trimmed.slice(-OUTPUT_CHARS)}`;
};

/** git's message without its `fatal:`/`error:` prefixes. */
export const gitMessage = (text: string, fallback: string) => tail(text).replace(/^(fatal|error): /gm, "") || fallback;

type WriteResult = { readonly _tag: "Exited"; readonly code: number; readonly output: string } | { readonly _tag: "TimedOut"; readonly output: string };

interface WriteOptions {
  /** Written to git's stdin (a commit message); none gives git an empty stdin. */
  readonly input?: string;
  readonly timeout: Duration.Duration;
  /** `GIT_SSH_COMMAND` for this run. */
  readonly ssh?: string;
}

const failed = (args: ReadonlyArray<string>) => (cause: unknown) => new GitFailed({ message: `Could not run git ${args[0]}`, cause });

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
export const succeed = (directory: string, args: ReadonlyArray<string>, options: WriteOptions) =>
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
