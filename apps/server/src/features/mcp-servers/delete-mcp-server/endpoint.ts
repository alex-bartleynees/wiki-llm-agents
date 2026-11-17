import { dirname } from "node:path";
import { DeleteMcpServerRequest } from "@wiki-agents/contracts/mcp-servers/delete-mcp-server/request";
import { DeleteMcpServerResponse } from "@wiki-agents/contracts/mcp-servers/delete-mcp-server/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { requireId, trashConfigFile } from "../../../shared/config-files.js";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { McpServerCatalog } from "../catalog.js";
import { MCP_EXTENSION, MCP_FOLDER } from "../definition.js";

/** Moves the server's file to the config directory's `.trash/`, if it is still the version you saw. */
export const deleteMcpServerEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaParams(DeleteMcpServerRequest);
  yield* requireId(request.serverId);
  const { folder } = yield* (yield* McpServerCatalog).current;
  const trashPath = yield* trashConfigFile(dirname(folder), MCP_FOLDER, request.serverId, MCP_EXTENSION, request.hash);
  return yield* HttpServerResponse.schemaJson(DeleteMcpServerResponse)({ trashPath });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ConfigFileInvalid: () => Effect.succeed(badRequest("Invalid MCP server id")),
    ConfigFileNotFound: () => Effect.succeed(notFound("MCP server not found")),
    ConfigFileChanged: () => Effect.succeed(conflict("The server's file has changed since you opened it; look at it again before deleting.")),
  }),
  Effect.catch(internalError("delete MCP server")),
);
