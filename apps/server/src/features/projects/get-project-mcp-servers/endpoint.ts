import { GetProjectMcpServersResponse } from "@wiki-agents/contracts/projects/get-project-mcp-servers/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { findProject } from "../find-project.js";
import { ProjectRepository } from "../repository.js";

const Params = Schema.Struct({ projectId: Schema.String });

export const getProjectMcpServersEndpoint = Effect.gen(function* () {
  const { projectId } = yield* HttpRouter.schemaPathParams(Params);
  const project = yield* findProject(projectId);
  const serverIds = yield* (yield* ProjectRepository).mcpServers(project.id);
  return yield* HttpServerResponse.schemaJson(GetProjectMcpServersResponse)({ serverIds });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
  }),
  Effect.catch(internalError("get project MCP servers")),
);
