import { RestartMcpServerRequest } from "@wiki-agents/contracts/mcp-servers/restart-mcp-server/request";
import { RestartMcpServerResponse } from "@wiki-agents/contracts/mcp-servers/restart-mcp-server/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { guarded } from "../../../shared/host-guard.js";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { McpPool } from "../pool.js";

/** Closes the server's connections and forgets its failures; reconnects a shared (`app`) one at once. */
export const restartMcpServerEndpoint = guarded(
  Effect.gen(function* () {
    const { serverId } = yield* HttpRouter.schemaPathParams(RestartMcpServerRequest);
    return yield* HttpServerResponse.schemaJson(RestartMcpServerResponse)({ status: yield* (yield* McpPool).restart(serverId) });
  }).pipe(
    Effect.catchTags({
      SchemaError: () => Effect.succeed(badRequest()),
      McpServerNotFound: (error) => Effect.succeed(notFound(error.reason)),
    }),
    Effect.catch(internalError("restart MCP server")),
  ),
);
