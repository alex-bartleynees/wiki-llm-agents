import { RemoveWorktreeRequest } from "@wiki-agents/contracts/threads/remove-worktree/request";
import { RemoveWorktreeResponse } from "@wiki-agents/contracts/threads/remove-worktree/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { removeWorktree } from "./use-case.js";

export const removeWorktreeEndpoint = Effect.gen(function* () {
  const { threadId } = yield* HttpRouter.schemaPathParams(RemoveWorktreeRequest);
  const response = yield* removeWorktree(threadId);
  return yield* HttpServerResponse.schemaJson(RemoveWorktreeResponse)(response);
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ThreadNotFound: () => Effect.succeed(notFound("Thread not found")),
    WorktreeNotFound: () => Effect.succeed(notFound("This thread has no worktree")),
    ThreadBusy: () => Effect.succeed(conflict("Stop the turn or answer it before removing the worktree")),
    WorktreeRefused: (error) => Effect.succeed(conflict(error.message)),
  }),
  Effect.catch(internalError("remove worktree")),
);
