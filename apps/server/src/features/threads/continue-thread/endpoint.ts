import { ContinueThreadRequest } from "@wiki-agents/contracts/threads/continue-thread/request";
import { ContinueThreadResponse } from "@wiki-agents/contracts/threads/continue-thread/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { continueThread } from "./use-case.js";

const Params = Schema.Struct({ threadId: Schema.String });

/** Makes the new thread; 409 when it can't work where asked (the worktree is gone, git refuses). */
export const continueThreadEndpoint = Effect.gen(function* () {
  const { threadId } = yield* HttpRouter.schemaPathParams(Params);
  const body = yield* HttpServerRequest.schemaBodyJson(ContinueThreadRequest);
  const response = yield* continueThread(threadId, body);
  return yield* HttpServerResponse.schemaJson(ContinueThreadResponse)(response, { status: 201 });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    ThreadNotFound: () => Effect.succeed(notFound("Thread not found")),
    ContinueRefused: (error) => Effect.succeed(conflict(error.reason)),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
    InvalidProject: (error) => Effect.succeed(badRequest(error.message)),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
    ProviderInstanceNotFound: () => Effect.succeed(conflict("This thread's provider isn't available any more")),
    AgentNotFound: (error) => Effect.succeed(conflict(error.reason)),
    WorktreeRefused: (error) => Effect.succeed(conflict(error.message)),
    ProjectFilesError: (error) => Effect.succeed(conflict(error.message)),
  }),
  Effect.catch(internalError("continue thread")),
);
