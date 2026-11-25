import { ListWorktreesRequest } from "@wiki-agents/contracts/projects/list-worktrees/request";
import { ListWorktreesResponse } from "@wiki-agents/contracts/projects/list-worktrees/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { listWorktrees } from "./use-case.js";

export const listWorktreesEndpoint = Effect.gen(function* () {
  const { projectId } = yield* HttpRouter.schemaPathParams(ListWorktreesRequest);
  const response = yield* listWorktrees(projectId);
  return yield* HttpServerResponse.schemaJson(ListWorktreesResponse)(response);
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
    VaultNotFound: () => Effect.succeed(notFound("The project's vault is gone")),
    GitFailed: (error) => Effect.succeed(conflict(error.message)),
  }),
  Effect.catch(internalError("list project worktrees")),
);
