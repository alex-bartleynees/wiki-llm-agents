import { Schema } from "effect";
import { AutonomyLevel } from "../agents/model.js";

/**
 * MCP servers the app connects to on behalf of every provider (GitHub, a browser...):
 * one YAML file each in the app's config directory, `mcp/<id>.yaml`. Values that are
 * secret are written as references (`${secret:github}`, `${env:NAME}`,
 * `${file:/run/secrets/x}`), which only the app resolves.
 */

/** A command the app runs and talks to over stdin and stdout. */
export const StdioTransport = Schema.Struct({
  type: Schema.Literal("stdio"),
  /** A path, or a name looked up on `PATH`. */
  command: Schema.String,
  args: Schema.Array(Schema.String),
  /** Added to the command's environment. */
  env: Schema.Record(Schema.String, Schema.String),
  /** Where it runs; null for the scope's own folder. */
  cwd: Schema.NullOr(Schema.String),
});
export type StdioTransport = typeof StdioTransport.Type;

/** A server reached over Streamable HTTP. */
export const HttpTransport = Schema.Struct({
  type: Schema.Literal("http"),
  url: Schema.String,
  /** Sent with every request. */
  headers: Schema.Record(Schema.String, Schema.String),
});
export type HttpTransport = typeof HttpTransport.Type;

export const McpTransport = Schema.Union([StdioTransport, HttpTransport]);
export type McpTransport = typeof McpTransport.Type;

/**
 * How many connections a server gets:
 * - `app`: one, shared by every thread (stateless APIs)
 * - `project`: one per project, run in its main working directory
 * - `thread`: one per thread (servers that keep state, such as a browser)
 */
export const McpScope = Schema.Literals(["app", "project", "thread"]);
export type McpScope = typeof McpScope.Type;

/**
 * How the app signs in to an HTTP server that asks for OAuth (the coffee journal's
 * Keycloak). Without it, a server that asks is still signed in to, registering a client
 * itself where the identity server allows that (Jira).
 */
export const McpOAuth = Schema.Struct({
  /** The client registered for this app at the identity server; null to register one when connecting. */
  clientId: Schema.NullOr(Schema.String),
  /** Scopes to ask for; empty for those the server advertises. `offline_access` is added when offered. */
  scopes: Schema.Array(Schema.String),
});
export type McpOAuth = typeof McpOAuth.Type;

/** A server's settings, as the editor saves them. */
export const McpServerInput = Schema.Struct({
  title: Schema.String,
  transport: McpTransport,
  scope: McpScope,
  /** Give its tools to every thread, whatever the agent; otherwise only to agents listing it (`mcp:`). */
  default: Schema.Boolean,
  /** What its tools need instead of the agent's own autonomy; null to follow the agent. */
  access: Schema.NullOr(AutonomyLevel),
  /** Sign-in settings; HTTP servers only, null for none. */
  oauth: Schema.NullOr(McpOAuth),
});
export type McpServerInput = typeof McpServerInput.Type;

export const McpServerSummary = Schema.Struct({
  /** The file name without `.yaml`, e.g. `github`; tools are named `<id>__<tool>`. */
  id: Schema.String,
  /** Absolute path of the server's file. */
  path: Schema.String,
  ...McpServerInput.fields,
});
export type McpServerSummary = typeof McpServerSummary.Type;

/** A tool a server offers, as its last tool list said. */
export const McpToolInfo = Schema.Struct({
  /** The server's own name for it; agents will see `<server id>__<name>`. */
  name: Schema.String,
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  /** The server marks it read-only (`readOnlyHint`), so it follows the agent's `read` autonomy; any other tool follows `tools`. */
  readOnly: Schema.Boolean,
});
export type McpToolInfo = typeof McpToolInfo.Type;

/** What agents call a server's tool: `<server id>__<tool>`, e.g. `coffee-app__coffee_journal_list_brews`. */
export const gatewayToolName = (serverId: string, tool: string) => `${serverId}__${tool}`;

/**
 * The longest `<server>__<tool>` the app gives agents. Claude Code names a tool
 * `mcp__wiki-agents-<thread id>__<name>` (55 characters before the name) and silently
 * drops tools whose whole name is too long: 115 characters worked, 155 didn't (checked
 * 2026-11-17). 60 keeps the whole name at 115, the longest seen working.
 */
export const MAX_GATEWAY_TOOL_NAME = 60;

/**
 * Why agents don't get a tool, or null when they do. Whether a call runs, asks or is
 * refused is decided per call, from the agent's autonomy and the server's `access`.
 */
export const gatewayToolProblem = (serverId: string, tool: Pick<McpToolInfo, "name">): string | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(tool.name)) return "Its name has characters other than letters, digits, _ and -, which some providers refuse.";
  const name = gatewayToolName(serverId, tool.name);
  if (name.length > MAX_GATEWAY_TOOL_NAME) return `${name} is ${name.length} characters, over the ${MAX_GATEWAY_TOOL_NAME} the app allows so Claude Code doesn't drop it.`;
  return null;
};

/**
 * - `idle`: no connection open (never used, or closed after a while unused)
 * - `connected`: at least one connection open
 * - `failed`: the last attempt to connect or call failed; `problem` says why
 */
export const McpServerState = Schema.Literals(["idle", "connected", "failed"]);
export type McpServerState = typeof McpServerState.Type;

/** How the app's connections to a server are doing; never holds a secret. */
export const McpServerStatus = Schema.Struct({
  serverId: Schema.String,
  state: McpServerState,
  /** Connections open now: one for `app`, one per project or thread in use otherwise. */
  connections: Schema.Number,
  /** The tools from the last list fetched (on connecting or testing); null until one has been. */
  tools: Schema.NullOr(Schema.Array(McpToolInfo)),
  /** When that list was fetched (ms since the epoch). */
  listedAt: Schema.NullOr(Schema.Number),
  /** The MCP version the server spoke last time, e.g. `2025-06-18`. */
  protocolVersion: Schema.NullOr(Schema.String),
  /** Why the last attempt failed; null after a success. */
  problem: Schema.NullOr(Schema.String),
  /** After failures the app waits before trying again; when it next will. Restart tries at once. */
  retryAt: Schema.NullOr(Schema.Number),
});
export type McpServerStatus = typeof McpServerStatus.Type;
