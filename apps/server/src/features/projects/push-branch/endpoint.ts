import { PushBranchRequest } from "@wiki-agents/contracts/projects/push-branch/request";
import { PushBranchResponse } from "@wiki-agents/contracts/projects/push-branch/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { pushBranch } from "./use-case.js";

const Params = Schema.Struct({ projectId: Schema.String });

export const pushBranchEndpoint = Effect.gen(function* () {
  const { projectId } = yield* HttpRouter.schemaPathParams(Params);
  const body = yield* HttpServerRequest.schemaBodyJson(PushBranchRequest);
  return yield* HttpServerResponse.schemaJson(PushBranchResponse)(yield* pushBranch(projectId, body));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    InvalidProject: (error) => Effect.succeed(badRequest(error.message)),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
    StaleReview: (error) => Effect.succeed(conflict(error.message)),
    GitRefused: (error) => Effect.succeed(conflict(error.message)),
    GitFailed: (error) => Effect.succeed(conflict(error.message)),
  }),
  Effect.catch(internalError("push project branch")),
);
