import { CheckWorktreeBranchRequest } from "@wiki-agents/contracts/projects/check-worktree-branch/request";
import { DeleteWorktreeBranchRequest } from "@wiki-agents/contracts/projects/delete-worktree-branch/request";
import { DeleteWorktreeBranchResponse } from "@wiki-agents/contracts/projects/delete-worktree-branch/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { deleteWorktreeBranch } from "./use-case.js";

export const deleteWorktreeBranchEndpoint = Effect.gen(function* () {
  const { projectId, threadId } = yield* HttpRouter.schemaPathParams(CheckWorktreeBranchRequest);
  const { confirmation } = yield* HttpServerRequest.schemaBodyJson(DeleteWorktreeBranchRequest);
  const response = yield* deleteWorktreeBranch(projectId, threadId, confirmation);
  return yield* HttpServerResponse.schemaJson(DeleteWorktreeBranchResponse)(response);
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
    WorktreeNotFound: () => Effect.succeed(notFound("Worktree not found")),
    HttpServerError: () => Effect.succeed(badRequest()),
    BranchCleanupRefused: (error) => Effect.succeed(conflict(error.message)),
  }),
  Effect.catch(internalError("delete worktree branch")),
);
