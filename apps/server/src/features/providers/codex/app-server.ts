import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { JsonRpcId, JsonRpcMessage } from "./protocol.js";

/**
 * A running `codex app-server`: JSON-RPC messages in and out over stdio. Tests swap
 * the launcher for one that plays recorded conversations
 * (`tests/fixtures/codex/fake-app-server.ts`); the recorder wraps the real one.
 */
export interface AppServerProcess {
  readonly send: (message: JsonRpcMessage) => void;
  /** Every message from Codex in order, then how it ended (null: closed by the app). Called once. */
  readonly listen: (handlers: { readonly message: (message: JsonRpcMessage) => void; readonly exit: (reason: string | null) => void }) => void;
  /** Ends the process. */
  readonly kill: () => void;
}

export interface LaunchOptions {
  readonly binary: string;
  readonly cwd: string;
  /** Added to this process's environment. */
  readonly env: Readonly<Record<string, string>>;
}

export interface CodexLauncher {
  readonly launch: (options: LaunchOptions) => AppServerProcess;
}

/** Lines of Codex's stderr kept to explain a crash. */
const STDERR_LINES = 20;

/** Codex's log lines are coloured; the reason reads better without. */
const ANSI = /\u001b\[[0-9;]*m/g;

export const CodexLauncherLive: CodexLauncher = {
  launch: ({ binary, cwd, env }) => {
    const child = spawn(binary, ["app-server"], { cwd, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    const stderr: Array<string> = [];
    let closing = false;
    let handlers: Parameters<AppServerProcess["listen"]>[0] | undefined;
    const early: Array<JsonRpcMessage> = [];
    let ended: { reason: string | null } | undefined;

    const deliver = (message: JsonRpcMessage) => (handlers === undefined ? early.push(message) : handlers.message(message));
    const end = (reason: string | null) => {
      if (ended !== undefined) return;
      ended = { reason };
      handlers?.exit(reason);
    };

    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(...chunk.toString("utf8").replace(ANSI, "").split("\n").filter((line) => line.trim() !== ""));
      stderr.splice(0, Math.max(0, stderr.length - STDERR_LINES));
    });
    createInterface({ input: child.stdout }).on("line", (line) => {
      if (line.trim() === "") return;
      try {
        deliver(JSON.parse(line) as JsonRpcMessage);
      } catch {
        stderr.push(`unreadable output: ${line.slice(0, 200)}`);
      }
    });
    child.stdin.on("error", () => {});
    child.once("error", (cause) =>
      end("code" in cause && cause.code === "ENOENT" ? `"${binary}" isn't installed` : cause.message),
    );
    child.once("exit", (code, signal) => {
      if (closing) return end(null);
      const detail = stderr.at(-1);
      end(`${signal === null ? `exit code ${code}` : signal}${detail === undefined ? "" : `: ${detail}`}`);
    });

    return {
      send: (message) => {
        if (ended === undefined && child.stdin.writable) child.stdin.write(`${JSON.stringify(message)}\n`);
      },
      listen: (next) => {
        handlers = next;
        for (const message of early.splice(0)) next.message(message);
        if (ended !== undefined) next.exit(ended.reason);
      },
      kill: () => {
        if (closing) return;
        closing = true;
        child.stdin.end();
        child.kill("SIGTERM");
        const force = setTimeout(() => child.kill("SIGKILL"), 2000);
        force.unref();
        child.once("exit", () => clearTimeout(force));
      },
    };
  },
};

export class RpcError extends Error {
  constructor(
    readonly method: string,
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

/** A request or notification from Codex. */
export type Incoming =
  | { readonly _tag: "notification"; readonly method: string; readonly params: unknown }
  | { readonly _tag: "request"; readonly id: JsonRpcId; readonly method: string; readonly params: unknown };

/** Codex is a JSON-RPC peer: the app sends it requests, it sends the app notifications and requests of its own. */
export interface RpcClient {
  readonly request: <A>(method: string, params: unknown) => Promise<A>;
  readonly notify: (method: string, params?: unknown) => void;
  readonly respond: (id: JsonRpcId, result: unknown) => void;
  readonly respondError: (id: JsonRpcId, message: string) => void;
  readonly kill: () => void;
}

/**
 * Speaks JSON-RPC over `process`: pairs responses with requests, and hands Codex's
 * own notifications and requests to `incoming`. When the process ends, waiting
 * requests fail and `exited` is called once.
 */
export const makeRpc = (
  process: AppServerProcess,
  incoming: (message: Incoming) => void,
  exited: (reason: string | null) => void,
): RpcClient => {
  let next = 0;
  let ended: string | null | undefined;
  const waiting = new Map<JsonRpcId, { readonly method: string; readonly resolve: (value: unknown) => void; readonly reject: (error: Error) => void }>();

  process.listen({
    message: (message) => {
      if (message.method !== undefined) {
        incoming(
          message.id === undefined
            ? { _tag: "notification", method: message.method, params: message.params }
            : { _tag: "request", id: message.id, method: message.method, params: message.params },
        );
        return;
      }
      if (message.id === undefined) return;
      const call = waiting.get(message.id);
      if (call === undefined) return;
      waiting.delete(message.id);
      if (message.error !== undefined) call.reject(new RpcError(call.method, message.error.message, message.error.code));
      else call.resolve(message.result);
    },
    exit: (reason) => {
      ended = reason;
      for (const call of waiting.values()) call.reject(new RpcError(call.method, `Codex stopped${reason === null ? "" : ` (${reason})`}`));
      waiting.clear();
      exited(reason);
    },
  });

  return {
    request: <A>(method: string, params: unknown) =>
      new Promise<A>((resolve, reject) => {
        if (ended !== undefined) return reject(new RpcError(method, `Codex stopped${ended === null ? "" : ` (${ended})`}`));
        next += 1;
        waiting.set(next, { method, resolve: resolve as (value: unknown) => void, reject });
        process.send({ id: next, method, params });
      }),
    notify: (method, params) => process.send(params === undefined ? { method } : { method, params }),
    respond: (id, result) => process.send({ id, result }),
    respondError: (id, message) => process.send({ id, error: { code: -32601, message } }),
    kill: () => process.kill(),
  };
};

export const CLIENT_INFO = { name: "wiki-agents", title: "wiki-agents", version: "0.1.0" } as const;

/** The handshake every connection starts with. */
export const initialize = async (rpc: RpcClient) => {
  await rpc.request("initialize", { clientInfo: CLIENT_INFO, capabilities: { experimentalApi: true, requestAttestation: false } });
  rpc.notify("initialized");
};
