import type { ConfigProblem } from "@wiki-agents/contracts/agents/model";
import { Context, Data, type Effect } from "effect";
import type { McpServerDefinition } from "./definition.js";

/** Every server file in the config directory at one moment. */
export interface McpServerList {
  /** `<config dir>/mcp`. */
  readonly folder: string;
  /** By title. */
  readonly servers: ReadonlyArray<McpServerDefinition>;
  /** Files that couldn't be used. */
  readonly problems: ReadonlyArray<ConfigProblem>;
}

/** No such server, or its file has problems (`problem` says what). */
export class McpServerNotFound extends Data.TaggedError("McpServerNotFound")<{
  readonly serverId: string;
  readonly problem: string | null;
}> {
  get reason() {
    return this.problem === null ? `There is no MCP server "${this.serverId}".` : `The MCP server "${this.serverId}" can't be used: ${this.problem}`;
  }
}

/**
 * The MCP servers defined in the app's config directory (`mcp/*.yaml`), read from
 * the files each time. Features read servers through this port only.
 */
export interface McpServerCatalogService {
  readonly current: Effect.Effect<McpServerList>;
  /** The server and its file's hash, for saving or deleting that version; null for a built-in server without a file. */
  readonly get: (serverId: string) => Effect.Effect<{ readonly server: McpServerDefinition; readonly hash: string | null }, McpServerNotFound>;
}

export class McpServerCatalog extends Context.Service<McpServerCatalog, McpServerCatalogService>()("McpServerCatalog") {}
