import { SuggestCommitMessageRequest } from "@wiki-agents/contracts/projects/suggest-commit-message/request";
import { SuggestCommitMessageResponse } from "@wiki-agents/contracts/projects/suggest-commit-message/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badGateway, badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { suggestCommitMessage } from "./use-case.js";

const Params = Schema.Struct({ projectId: Schema.String });

export const suggestCommitMessageEndpoint = Effect.gen(function* () {
  const { projectId } = yield* HttpRouter.schemaPathParams(Params);
  const body = yield* HttpServerRequest.schemaBodyJson(SuggestCommitMessageRequest);
  return yield* HttpServerResponse.schemaJson(SuggestCommitMessageResponse)(yield* suggestCommitMessage(projectId, body));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    InvalidProject: (error) => Effect.succeed(badRequest(error.message)),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
    StaleReview: (error) => Effect.succeed(conflict(error.message)),
    GitFailed: (error) => Effect.succeed(conflict(error.message)),
    NoCommitMessageProvider: () => Effect.succeed(conflict("No provider is set up to suggest a message")),
    ProviderInstanceNotFound: () => Effect.succeed(conflict("The provider chosen for commit messages isn't available; pick another in Settings")),
    ProviderError: (error) => Effect.succeed(badGateway(error.message)),
  }),
  Effect.catch(internalError("suggest commit message")),
);
