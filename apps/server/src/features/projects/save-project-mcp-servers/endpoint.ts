import { SaveProjectMcpServersRequest } from "@wiki-agents/contracts/projects/save-project-mcp-servers/request";
import { SaveProjectMcpServersResponse } from "@wiki-agents/contracts/projects/save-project-mcp-servers/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { saveProjectMcpServers } from "./use-case.js";

const Params = Schema.Struct({ projectId: Schema.String });

export const saveProjectMcpServersEndpoint = Effect.gen(function* () {
  const { projectId } = yield* HttpRouter.schemaPathParams(Params);
  const body = yield* HttpServerRequest.schemaBodyJson(SaveProjectMcpServersRequest);
  return yield* HttpServerResponse.schemaJson(SaveProjectMcpServersResponse)(yield* saveProjectMcpServers(projectId, body));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    InvalidProject: (error) => Effect.succeed(badRequest(error.message)),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
  }),
  Effect.catch(internalError("save project MCP servers")),
);
