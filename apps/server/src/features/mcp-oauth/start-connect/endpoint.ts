import { StartConnectRequest } from "@wiki-agents/contracts/mcp-oauth/start-connect/request";
import { StartConnectResponse } from "@wiki-agents/contracts/mcp-oauth/start-connect/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { guarded, isTrustedHost } from "../../../shared/host-guard.js";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { McpConnections } from "../connections.js";

/**
 * The address the app is browsed at: the request's `Origin` (the origin guard has
 * checked it matches `Host`), else `http://<Host>` for a client that sends none.
 */
const browsedOrigin = (request: HttpServerRequest.HttpServerRequest): string | null => {
  const origin = request.headers["origin"] ?? (request.headers["host"] === undefined ? undefined : `http://${request.headers["host"]}`);
  if (origin === undefined) return null;
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && isTrustedHost(url.host) ? url.origin : null;
  } catch {
    return null;
  }
};

export const startConnectEndpoint = guarded(
  Effect.gen(function* () {
    const { serverId } = yield* HttpRouter.schemaPathParams(StartConnectRequest);
    const origin = browsedOrigin(yield* HttpServerRequest.HttpServerRequest);
    if (origin === null) return badRequest("Open the app at localhost, an IP address or its tailnet name to sign in.");
    return yield* HttpServerResponse.schemaJson(StartConnectResponse)(yield* (yield* McpConnections).start(serverId, origin));
  }).pipe(
    Effect.catchTags({
      SchemaError: () => Effect.succeed(badRequest()),
      McpServerNotFound: (error) => Effect.succeed(notFound(error.reason)),
      SignInFailed: (error) => Effect.succeed(conflict(error.reason)),
      SecretStoreUnavailable: (error) => Effect.succeed(conflict(error.reason)),
    }),
    Effect.catch(() => internalError("start MCP sign-in")("(details withheld)")),
  ),
);
