import { tmpdir } from "node:os";
import { Effect } from "effect";
import { runBinary } from "../binary.js";
import { ProviderError } from "../port.js";
import { type CodexLauncher, initialize, makeRpc, type RpcClient } from "./app-server.js";
import type { AccountResponse } from "./protocol.js";

/**
 * The app-server protocol was checked against Codex 0.166.0 (`protocol.ts`). Codex
 * releases often and keeps the v2 protocol compatible, so any later 0.x is accepted.
 */
export const SUPPORTED_VERSION = "0.166.0";

const parts = (version: string) => version.split(/[.-]/).slice(0, 3).map(Number);

export const isSupportedVersion = (version: string) => {
  const [major = Number.NaN, minor = Number.NaN, patch = Number.NaN] = parts(version);
  const [wantMajor, wantMinor, wantPatch] = parts(SUPPORTED_VERSION) as [number, number, number];
  if (major !== wantMajor) return false;
  return minor > wantMinor || (minor === wantMinor && patch >= wantPatch);
};

export const notInstalled = (binary: string) => `Codex isn't installed (no "${binary}" on PATH).`;

/** The installed Codex's version (`codex --version` prints `codex-cli 0.166.0`). */
export const binaryVersion = (binary: string) =>
  Effect.flatMap(runBinary(binary, ["--version"], notInstalled(binary)), (output) => {
    const version = /(\d+\.\d+\.\d+\S*)/.exec(output)?.[1];
    return version === undefined
      ? Effect.fail(new ProviderError({ message: `"${binary} --version" printed no version: ${output.trim()}` }))
      : Effect.succeed(version);
  });

export const describeError = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/**
 * Runs `use` on a short-lived `codex app-server` in `cwd` (for its models or
 * account), then closes it. Starts no thread and spends nothing.
 */
export const withAppServer = <A>(launcher: CodexLauncher, binary: string, cwd: string, what: string, use: (rpc: RpcClient) => Promise<A>) =>
  Effect.tryPromise({
    try: async () => {
      let stopped: (reason: string | null) => void = () => {};
      const exited = new Promise<never>((_, reject) => {
        stopped = (reason) => reject(new Error(reason === null ? "Codex stopped" : reason));
      });
      exited.catch(() => {});
      const rpc = makeRpc(launcher.launch({ binary, cwd, env: {} }), () => {}, (reason) => stopped(reason));
      try {
        await Promise.race([initialize(rpc), exited]);
        return await Promise.race([use(rpc), exited]);
      } finally {
        rpc.kill();
      }
    },
    catch: (cause) => new ProviderError({ message: `${what}: ${describeError(cause)}`, cause }),
  });

export interface AuthStatus {
  readonly loggedIn: boolean;
  /** Who is signed in, e.g. `you@example.com (plus)`; null when Codex doesn't say. */
  readonly account: string | null;
}

/** Whether Codex is signed in, and as whom, from `account/read`. */
export const authStatus = (launcher: CodexLauncher, binary: string) =>
  withAppServer(launcher, binary, tmpdir(), "Couldn't ask Codex who is signed in", (rpc) =>
    rpc.request<AccountResponse>("account/read", { refreshToken: false }),
  ).pipe(
    Effect.map(({ account, requiresOpenaiAuth }): AuthStatus => {
      if (account === null) return { loggedIn: !requiresOpenaiAuth, account: null };
      if (account.type === "chatgpt" && "planType" in account) {
        const who = account.email ?? "ChatGPT";
        return { loggedIn: true, account: `${who} (${account.planType})` };
      }
      return { loggedIn: true, account: account.type === "apiKey" ? "API key" : account.type };
    }),
  );
