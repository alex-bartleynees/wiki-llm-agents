import { TestMcpServerRequest } from "@wiki-agents/contracts/mcp-servers/test-mcp-server/request";
import { TestMcpServerResponse } from "@wiki-agents/contracts/mcp-servers/test-mcp-server/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { guarded } from "../../../shared/host-guard.js";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { McpPool } from "../pool.js";

/**
 * Connects to the server on its own, with its secrets filled in, and lists its tools.
 * Guarded like the secrets: the request makes the app use them.
 */
export const testMcpServerEndpoint = guarded(
  Effect.gen(function* () {
    const { serverId } = yield* HttpRouter.schemaPathParams(TestMcpServerRequest);
    return yield* HttpServerResponse.schemaJson(TestMcpServerResponse)({ status: yield* (yield* McpPool).test(serverId) });
  }).pipe(
    Effect.catchTags({
      SchemaError: () => Effect.succeed(badRequest()),
      McpServerNotFound: (error) => Effect.succeed(notFound(error.reason)),
    }),
    Effect.catch(internalError("test MCP server")),
  ),
);
