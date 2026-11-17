import { GetMcpServerRequest } from "@wiki-agents/contracts/mcp-servers/get-mcp-server/request";
import { GetMcpServerResponse } from "@wiki-agents/contracts/mcp-servers/get-mcp-server/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { McpServerCatalog } from "../catalog.js";

/** The server as its file is on disk now, with the hash for saving or deleting that version. */
export const getMcpServerEndpoint = Effect.gen(function* () {
  const { serverId } = yield* HttpRouter.schemaPathParams(GetMcpServerRequest);
  return yield* HttpServerResponse.schemaJson(GetMcpServerResponse)(yield* (yield* McpServerCatalog).get(serverId));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    McpServerNotFound: (error) => Effect.succeed(notFound(error.reason)),
  }),
  Effect.catch(internalError("get MCP server")),
);
