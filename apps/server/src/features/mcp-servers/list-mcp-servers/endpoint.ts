import { ListMcpServersResponse } from "@wiki-agents/contracts/mcp-servers/list-mcp-servers/response";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import { internalError } from "../../../shared/http-errors.js";
import { McpServerCatalog } from "../catalog.js";
import { McpPool } from "../pool.js";

/** The server files, and how the app's connections to each are doing (from memory; nothing connects). */
export const listMcpServersEndpoint = Effect.gen(function* () {
  const list = yield* (yield* McpServerCatalog).current;
  const statuses = new Map((yield* (yield* McpPool).statuses).map((status) => [status.serverId, status]));
  const idle = (serverId: string) => ({ serverId, state: "idle", connections: 0, tools: null, listedAt: null, protocolVersion: null, problem: null, retryAt: null }) as const;
  return yield* HttpServerResponse.schemaJson(ListMcpServersResponse)({ ...list, statuses: list.servers.map((server) => statuses.get(server.id) ?? idle(server.id)) });
}).pipe(Effect.catch(internalError("list MCP servers")));
