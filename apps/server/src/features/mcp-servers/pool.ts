import type { McpServerStatus } from "@wiki-agents/contracts/mcp-servers/model";
import type { BrowserSignIn } from "@wiki-agents/contracts/projects/model";
import { Context, Data, type Duration, type Effect } from "effect";
import type { McpSchema } from "effect/ai";
import type { McpServerNotFound } from "./catalog.js";

/**
 * Whose connection a request uses. The server's `scope` picks the part that counts:
 * `app` shares one connection, `project` one per project (run in `cwd`), `thread` one
 * per thread.
 */
export interface McpScopeContext {
  readonly threadId: string;
  /** Null for a thread outside any project: it then gets a connection of its own. */
  readonly projectId: string | null;
  /** Where a `stdio` server runs when its file gives no `cwd`: the project's main working directory. */
  readonly cwd: string | null;
  /**
   * The project's browser sign-ins, as of the thread's last turn start; a server with
   * `browserSignIns` gets their secrets (`sign-ins.ts`). Left out: none.
   */
  readonly signIns?: ReadonlyArray<BrowserSignIn>;
}

/** The server can't be reached or used now; `reason` is for the user and holds no secret. */
export class McpServerUnavailable extends Data.TaggedError("McpServerUnavailable")<{ readonly serverId: string; readonly reason: string }> {}

/** The server has no tool of that name (its list changed, or the name is wrong). */
export class McpToolNotFound extends Data.TaggedError("McpToolNotFound")<{ readonly serverId: string; readonly tool: string }> {}

/** The server answered a call with an error, or not in time; the connection stays. */
export class McpCallFailed extends Data.TaggedError("McpCallFailed")<{ readonly serverId: string; readonly tool: string; readonly reason: string }> {}

/**
 * A tool's result as plain JSON (`CallToolResult`: `content`, `structuredContent`,
 * `isError`), with every secret the connection used redacted.
 */
export type McpToolResult = Readonly<Record<string, unknown>>;

/**
 * The app's connections to the MCP servers in `mcp/*.yaml`: one per server and scope
 * key, opened on first use and closed after a while unused, retried with growing waits
 * after failures. Secrets are filled in here and nowhere else. Settings reads statuses
 * and tests and restarts servers; the gateway lists and calls tools.
 */
export interface McpPoolService {
  /** One per valid server file, in the catalog's order. */
  readonly statuses: Effect.Effect<ReadonlyArray<McpServerStatus>>;
  /** Connects once, apart from the pooled connections, lists the tools and disconnects. A failure is in the status. */
  readonly test: (serverId: string) => Effect.Effect<McpServerStatus, McpServerNotFound>;
  /** Closes the server's connections and forgets its failures; reconnects an `app` server at once. */
  readonly restart: (serverId: string) => Effect.Effect<McpServerStatus, McpServerNotFound>;
  /** The server's tools, as listed when its connection for `context` opened. */
  readonly tools: (serverId: string, context: McpScopeContext) => Effect.Effect<ReadonlyArray<McpSchema.Tool>, McpServerNotFound | McpServerUnavailable>;
  /** Calls a tool through the connection for `context`. No deadline unless `timeout` is given. */
  readonly callTool: (
    serverId: string,
    context: McpScopeContext,
    tool: string,
    args: Readonly<Record<string, unknown>>,
    options?: { readonly timeout?: Duration.Input },
  ) => Effect.Effect<McpToolResult, McpServerNotFound | McpServerUnavailable | McpToolNotFound | McpCallFailed>;
}

export class McpPool extends Context.Service<McpPool, McpPoolService>()("McpPool") {}
