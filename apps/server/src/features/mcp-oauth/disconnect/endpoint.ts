import { DisconnectRequest } from "@wiki-agents/contracts/mcp-oauth/disconnect/request";
import { DisconnectResponse } from "@wiki-agents/contracts/mcp-oauth/disconnect/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { guarded } from "../../../shared/host-guard.js";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { McpConnections } from "../connections.js";

export const disconnectEndpoint = guarded(
  Effect.gen(function* () {
    const { serverId } = yield* HttpRouter.schemaPathParams(DisconnectRequest);
    return yield* HttpServerResponse.schemaJson(DisconnectResponse)({ connection: yield* (yield* McpConnections).disconnect(serverId) });
  }).pipe(
    Effect.catchTags({
      SchemaError: () => Effect.succeed(badRequest()),
      McpServerNotFound: (error) => Effect.succeed(notFound(error.reason)),
      SecretStoreUnavailable: (error) => Effect.succeed(conflict(error.reason)),
    }),
    Effect.catch(() => internalError("disconnect MCP server")("(details withheld)")),
  ),
);
