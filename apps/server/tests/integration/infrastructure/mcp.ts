import { Effect } from "effect";
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http";
import { McpTokens } from "../../../src/features/mcp/tokens.js";

/** A JSON-RPC answer from `/mcp`: a result or an error. */
interface RpcResponse {
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

/** What `tools/call` returns. */
export interface ToolResult {
  readonly isError: boolean;
  readonly content: ReadonlyArray<{ readonly type: string; readonly text: string }>;
  readonly structuredContent?: Record<string, unknown>;
}

const PROTOCOL = "2025-06-18";

export const postMcp = (body: unknown, headers: Readonly<Record<string, string>>) =>
  HttpClient.execute(
    HttpClientRequest.post("/mcp").pipe(
      HttpClientRequest.setHeaders({ accept: "application/json, text/event-stream", ...headers }),
      HttpClientRequest.bodyJsonUnsafe(body),
    ),
  );

const json = (response: HttpClientResponse.HttpClientResponse) => Effect.map(response.json, (body) => body as RpcResponse);

/**
 * An MCP session over the app's real `/mcp` endpoint with `token`, as OpenCode opens
 * one: initialize, then requests carrying the session id.
 */
export const mcpSession = (token: string) =>
  Effect.gen(function* () {
    const auth = { authorization: `Bearer ${token}` };
    const init = yield* postMcp(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "test", version: "1" } } },
      auth,
    );
    if (init.status !== 200) return yield* Effect.die(new Error(`initialize answered ${init.status}`));
    const headers = { ...auth, "mcp-session-id": init.headers["mcp-session-id"] ?? "", "mcp-protocol-version": PROTOCOL };
    yield* postMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, headers);
    let id = 1;
    const rpc = (method: string, params?: unknown) => Effect.flatMap(postMcp({ jsonrpc: "2.0", id: ++id, method, params }, headers), json);
    /** A tool's result; dies on a JSON-RPC error (see `callError`). */
    const call = (name: string, args: Record<string, unknown> = {}) =>
      Effect.flatMap(rpc("tools/call", { name, arguments: args }), (response) =>
        response.error === undefined ? Effect.succeed(response.result as ToolResult) : Effect.die(new Error(`${name}: ${response.error.message}`)),
      );
    /** The JSON-RPC error message a call gets (invalid arguments); dies if it succeeds. */
    const callError = (name: string, args: Record<string, unknown>) =>
      Effect.flatMap(rpc("tools/call", { name, arguments: args }), (response) =>
        response.error === undefined ? Effect.die(new Error(`${name} succeeded`)) : Effect.succeed(response.error.message),
      );
    /** A successful tool's structured result. */
    const result = <A = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}) =>
      Effect.flatMap(call(name, args), (outcome) =>
        outcome.isError ? Effect.die(new Error(`${name} failed: ${outcome.content[0]?.text}`)) : Effect.succeed(outcome.structuredContent as A),
      );
    return { rpc, call, callError, result };
  });

/** A token for a thread, as its actor would issue one. */
export const tokenFor = (threadId: string, vaultId: string) =>
  Effect.gen(function* () {
    return yield* (yield* McpTokens).issue({ threadId, vaultId });
  });
