import { GetAgentRequest } from "@wiki-agents/contracts/agents/get-agent/request";
import { GetAgentResponse } from "@wiki-agents/contracts/agents/get-agent/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { getAgent } from "./use-case.js";

export const getAgentEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaPathParams(GetAgentRequest);
  return yield* HttpServerResponse.schemaJson(GetAgentResponse)(yield* getAgent(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    AgentNotFound: (error) => Effect.succeed(notFound(error.reason)),
  }),
  Effect.catch(internalError("get agent")),
);
