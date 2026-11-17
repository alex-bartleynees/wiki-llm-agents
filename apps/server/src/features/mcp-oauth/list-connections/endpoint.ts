import { ListConnectionsResponse } from "@wiki-agents/contracts/mcp-oauth/list-connections/response";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import { guarded } from "../../../shared/host-guard.js";
import { internalError } from "../../../shared/http-errors.js";
import { McpConnections } from "../connections.js";

/** Each server's sign-in: state, expiry and scopes; never a token. */
export const listConnectionsEndpoint = guarded(
  Effect.gen(function* () {
    return yield* HttpServerResponse.schemaJson(ListConnectionsResponse)({ connections: yield* (yield* McpConnections).list });
  }).pipe(Effect.catch(() => internalError("list MCP sign-ins")("(details withheld)"))),
);
