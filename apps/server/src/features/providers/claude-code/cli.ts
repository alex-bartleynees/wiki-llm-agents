import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { Effect, Schema } from "effect";
import { ProviderError } from "../port.js";

/**
 * The Claude Agent SDK this app is built with (`@anthropic-ai/claude-agent-sdk`
 * 0.3.316) speaks to Claude Code 2.1.316; any 2.1.x is accepted.
 */
export const SUPPORTED_VERSION = "2.1.316";

export const isSupportedVersion = (version: string) => {
  const [major, minor] = version.split(".");
  const [supportedMajor, supportedMinor] = SUPPORTED_VERSION.split(".");
  return major === supportedMajor && minor === supportedMinor;
};

/**
 * `binary` as an absolute path: as given when it has a slash, else the first match on
 * `PATH`. The SDK checks the executable exists before it spawns it, so it needs a path.
 */
export const resolveBinary = (binary: string): string | undefined => {
  const executable = (path: string) => {
    try {
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (binary.includes("/")) {
    const path = resolve(binary);
    return executable(path) ? path : undefined;
  }
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir !== "" && executable(join(dir, binary))) return join(dir, binary);
  }
  return undefined;
};

export const notInstalled = (binary: string) => `Claude Code isn't installed (no "${binary}" on PATH).`;

/** Runs `binary args...` to the end; its stdout, or why it failed. */
const run = (binary: string, args: ReadonlyArray<string>) =>
  Effect.callback<string, ProviderError>((resume) => {
    const child = spawn(binary, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errors += chunk.toString("utf8");
    });
    child.once("error", (cause) =>
      resume(Effect.fail(new ProviderError({ message: "code" in cause && cause.code === "ENOENT" ? notInstalled(binary) : cause.message, cause }))),
    );
    child.once("exit", (code) =>
      resume(
        code === 0 || output.trim() !== ""
          ? Effect.succeed(output)
          : Effect.fail(new ProviderError({ message: `"${binary} ${args.join(" ")}" failed: ${errors.trim() || `exit code ${code}`}` })),
      ),
    );
    return Effect.sync(() => child.kill());
  });

/** The installed Claude Code's version (`claude --version` prints `2.1.316 (Claude Code)`). */
export const binaryVersion = (binary: string) =>
  Effect.flatMap(run(binary, ["--version"]), (output) => {
    const version = /(\d+\.\d+\.\d+\S*)/.exec(output)?.[1];
    return version === undefined
      ? Effect.fail(new ProviderError({ message: `"${binary} --version" printed no version: ${output.trim()}` }))
      : Effect.succeed(version);
  });

/** What `claude auth status` reports; only the fields the app shows. */
const AuthStatusJson = Schema.Struct({
  loggedIn: Schema.Boolean,
  email: Schema.optionalKey(Schema.NullOr(Schema.String)),
  subscriptionType: Schema.optionalKey(Schema.NullOr(Schema.String)),
  authMethod: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export interface AuthStatus {
  readonly loggedIn: boolean;
  /** Who is signed in, e.g. `you@example.com (pro)`; null when Claude Code doesn't say. */
  readonly account: string | null;
}

/** Whether Claude Code is signed in, and as whom. Opens no session and spends nothing. */
export const authStatus = (binary: string) =>
  Effect.flatMap(run(binary, ["auth", "status"]), (output) =>
    Effect.try({
      try: () => Schema.decodeUnknownSync(AuthStatusJson)(JSON.parse(output)),
      catch: (cause) => new ProviderError({ message: `"${binary} auth status" printed something unexpected.`, cause }),
    }).pipe(
      Effect.map((status): AuthStatus => {
        const plan = status.subscriptionType ?? null;
        const who = status.email ?? null;
        return { loggedIn: status.loggedIn, account: who === null ? null : plan === null ? who : `${who} (${plan})` };
      }),
    ),
  );
