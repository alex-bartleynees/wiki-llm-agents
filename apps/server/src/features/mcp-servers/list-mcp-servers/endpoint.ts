import { ListMcpServersResponse } from "@wiki-agents/contracts/mcp-servers/list-mcp-servers/response";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import { internalError } from "../../../shared/http-errors.js";
import { McpServerCatalog } from "../catalog.js";

export const listMcpServersEndpoint = Effect.gen(function* () {
  return yield* HttpServerResponse.schemaJson(ListMcpServersResponse)(yield* (yield* McpServerCatalog).current);
}).pipe(Effect.catch(internalError("list MCP servers")));
