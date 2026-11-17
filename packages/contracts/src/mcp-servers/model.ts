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

/** A server's settings, as the editor saves them. */
export const McpServerInput = Schema.Struct({
  title: Schema.String,
  transport: McpTransport,
  scope: McpScope,
  /** Give its tools to every thread, whatever the agent. */
  default: Schema.Boolean,
  /** What its tools need instead of the agent's own autonomy; null to follow the agent. */
  access: Schema.NullOr(AutonomyLevel),
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
