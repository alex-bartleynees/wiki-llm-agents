import { CreateThreadRequest } from "@wiki-agents/contracts/threads/create-thread/request";
import { CreateThreadResponse } from "@wiki-agents/contracts/threads/create-thread/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { createThread } from "./use-case.js";

const Params = Schema.Struct({ vaultId: Schema.String });

/** The vault comes from the route, the provider and agent from the body. */
export const createThreadEndpoint = Effect.gen(function* () {
  const { vaultId } = yield* HttpRouter.schemaPathParams(Params);
  const body = yield* HttpServerRequest.schemaBodyJson(CreateThreadRequest);
  const response = yield* createThread({ ...body, vaultId });
  return yield* HttpServerResponse.schemaJson(CreateThreadResponse)(response, { status: 201 });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
    InvalidProject: (error) => Effect.succeed(badRequest(error.message)),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
    ProviderInstanceNotFound: () => Effect.succeed(badRequest("Unknown provider")),
    AgentNotFound: (error) => Effect.succeed(badRequest(error.reason)),
  }),
  Effect.catch(internalError("create thread")),
);
