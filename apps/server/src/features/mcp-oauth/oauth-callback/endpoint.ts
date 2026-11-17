import { CONNECT_FAILED_PARAM, CONNECTED_PARAM } from "@wiki-agents/contracts/mcp-oauth/model";
import { OAuthCallbackRequest } from "@wiki-agents/contracts/mcp-oauth/oauth-callback/request";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { guarded } from "../../../shared/host-guard.js";
import { McpConnections } from "../connections.js";

const settings = (param: string, value: string) => HttpServerResponse.redirect(`/settings?${new URLSearchParams({ [param]: value }).toString()}`, { status: 303 });

/**
 * Where the identity server sends the browser back: finishes the sign-in and goes on
 * to Settings, which says whether it worked. The code is never logged.
 */
export const oauthCallbackEndpoint = guarded(
  Effect.gen(function* () {
    const query = yield* HttpServerRequest.schemaSearchParams(OAuthCallbackRequest);
    const connection = yield* (yield* McpConnections).finish({
      code: query.code ?? null,
      state: query.state ?? null,
      error: query.error ?? null,
      errorDescription: query.error_description ?? null,
    });
    return settings(CONNECTED_PARAM, connection.serverId);
  }).pipe(
    Effect.catchTags({
      SchemaError: () => Effect.succeed(settings(CONNECT_FAILED_PARAM, "The identity server's answer wasn't readable.")),
      SignInUnknown: (error) => Effect.succeed(settings(CONNECT_FAILED_PARAM, error.reason)),
      SignInFailed: (error) => Effect.succeed(settings(CONNECT_FAILED_PARAM, error.reason)),
      GrantRejected: (error) => Effect.succeed(settings(CONNECT_FAILED_PARAM, error.reason)),
      SecretStoreUnavailable: (error) => Effect.succeed(settings(CONNECT_FAILED_PARAM, error.reason)),
    }),
    Effect.catch(() =>
      Effect.andThen(Effect.logError("finish MCP sign-in failed", "(details withheld)"), Effect.succeed(settings(CONNECT_FAILED_PARAM, "Something went wrong; connect again."))),
    ),
  ),
);
