import { CheckWorktreeBranchRequest } from "@wiki-agents/contracts/projects/check-worktree-branch/request";
import { CheckWorktreeBranchResponse } from "@wiki-agents/contracts/projects/check-worktree-branch/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { checkWorktreeBranch } from "./use-case.js";

export const checkWorktreeBranchEndpoint = Effect.gen(function* () {
  const { projectId, threadId } = yield* HttpRouter.schemaPathParams(CheckWorktreeBranchRequest);
  const response = yield* checkWorktreeBranch(projectId, threadId);
  return yield* HttpServerResponse.schemaJson(CheckWorktreeBranchResponse)(response);
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
    WorktreeNotFound: () => Effect.succeed(notFound("Worktree not found")),
  }),
  Effect.catch(internalError("check worktree branch")),
);
