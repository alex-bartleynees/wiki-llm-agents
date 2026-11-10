import { SetAgentRequest } from "@wiki-agents/contracts/threads/set-agent/request";
import { SetAgentResponse } from "@wiki-agents/contracts/threads/set-agent/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { setAgent } from "./use-case.js";

const Params = Schema.Struct({ threadId: Schema.String });

export const setAgentEndpoint = Effect.gen(function* () {
  const { threadId } = yield* HttpRouter.schemaPathParams(Params);
  const body = yield* HttpServerRequest.schemaBodyJson(SetAgentRequest);
  return yield* HttpServerResponse.schemaJson(SetAgentResponse)(yield* setAgent({ ...body, threadId }));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    ThreadNotFound: () => Effect.succeed(notFound("Thread not found")),
    AgentNotFound: (error) => Effect.succeed(badRequest(error.reason)),
  }),
  Effect.catch(internalError("set agent")),
);
