import { constants } from "node:buffer";
import { Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

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
