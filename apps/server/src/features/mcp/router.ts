import { Effect, Layer } from "effect";
import { McpProtocol, McpServer } from "effect/ai";
import { ThreadActors } from "../threads/thread-actors.js";
import { ManagerThreadRegistrations } from "./manager-thread-toolkit.js";
import { McpAuth } from "./auth.js";
import { McpGateway } from "../mcp-gateway/gateway.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { VaultToolkit, VaultToolkitLive } from "./toolkit.js";

/** The path OpenCode (and later Claude Code) is given for the vault tools. */
export const MCP_PATH = "/mcp";

/**
 * Lets the gateway register other servers' tools on this server as threads need them,
 * each call checked by the calling thread's actor.
 */
const GatewayRegistrations = Layer.effectDiscard(
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const actors = yield* ThreadActors;
    yield* (yield* McpGateway).attach(server, {
      approve: (threadId, call) =>
        actors.approveToolCall(threadId, call).pipe(
          Effect.mapError((error) =>
            error._tag === "ToolCallRefused" ? { message: error.message }
            : error._tag === "NoTurnRunning" ? { message: "Other servers' tools can only be used during a running turn." }
            : { message: `The app couldn't check this call (${error._tag}), so it didn't run.` },
          ),
        ),
    });
  }),
);

/**
 * The vault MCP server: Streamable HTTP at `/mcp`, every request authenticated by a
 * thread's bearer token (`McpAuth`). The tools are a second transport over the same
 * use cases as the HTTP API, plus the gateway's tools from other MCP servers.
 */
export const mcpRouter = McpServer.layerHttp({
  name: "wiki-agents",
  version: "0.1.0",
  instructions: SERVER_INSTRUCTIONS,
  path: MCP_PATH,
  protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26, McpProtocol.v2026_07_28],
  registrations: Layer.mergeAll(McpServer.toolkit(VaultToolkit).pipe(Layer.provide(VaultToolkitLive)), GatewayRegistrations, ManagerThreadRegistrations),
}).pipe(Layer.provide(McpAuth.layer));
