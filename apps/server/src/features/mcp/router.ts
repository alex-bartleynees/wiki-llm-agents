import { Layer } from "effect";
import { McpProtocol, McpServer } from "effect/ai";
import { McpAuth } from "./auth.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { VaultToolkit, VaultToolkitLive } from "./toolkit.js";

/** The path OpenCode (and later Claude Code) is given for the vault tools. */
export const MCP_PATH = "/mcp";

/**
 * The vault MCP server: Streamable HTTP at `/mcp`, every request authenticated by a
 * thread's bearer token (`McpAuth`). The tools are a second transport over the same
 * use cases as the HTTP API.
 */
export const mcpRouter = McpServer.layerHttp({
  name: "wiki-agents",
  version: "0.1.0",
  instructions: SERVER_INSTRUCTIONS,
  path: MCP_PATH,
  protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26, McpProtocol.v2026_07_28],
  registrations: McpServer.toolkit(VaultToolkit).pipe(Layer.provide(VaultToolkitLive)),
}).pipe(Layer.provide(McpAuth.layer));
