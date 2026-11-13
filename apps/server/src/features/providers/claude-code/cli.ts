import { Effect, Schema } from "effect";
import { resolveBinary, runBinary } from "../binary.js";
import { ProviderError } from "../port.js";

/** The SDK checks the executable exists before it spawns it, so it needs a path. */
export { resolveBinary };

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

export const notInstalled = (binary: string) => `Claude Code isn't installed (no "${binary}" on PATH).`;

const run = (binary: string, args: ReadonlyArray<string>) => runBinary(binary, args, notInstalled(binary));

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
