import { SaveMcpServerRequest } from "@wiki-agents/contracts/mcp-servers/save-mcp-server/request";
import { SaveMcpServerResponse } from "@wiki-agents/contracts/mcp-servers/save-mcp-server/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, unprocessable } from "../../../shared/http-errors.js";
import { saveMcpServer } from "./use-case.js";

const Params = Schema.Struct({ serverId: Schema.String });

export const saveMcpServerEndpoint = Effect.gen(function* () {
  const { serverId } = yield* HttpRouter.schemaPathParams(Params);
  const body = yield* HttpServerRequest.schemaBodyJson(SaveMcpServerRequest);
  return yield* HttpServerResponse.schemaJson(SaveMcpServerResponse)(yield* saveMcpServer({ ...body, serverId }));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ConfigFileInvalid: (error) => Effect.succeed(unprocessable(error.problems)),
    ConfigFileChanged: () =>
      Effect.succeed(conflict("The server's file has changed since you opened it (on another machine, or by hand); look at it again before saving.")),
  }),
  Effect.catch(internalError("save MCP server")),
);
