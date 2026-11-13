import { SaveAgentRequest } from "@wiki-agents/contracts/agents/save-agent/request";
import { SaveAgentResponse } from "@wiki-agents/contracts/agents/save-agent/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError } from "../../../shared/http-errors.js";
import { unprocessable } from "../config-errors.js";
import { saveAgent } from "./use-case.js";

const Params = Schema.Struct({ agentId: Schema.String });

export const saveAgentEndpoint = Effect.gen(function* () {
  const { agentId } = yield* HttpRouter.schemaPathParams(Params);
  const body = yield* HttpServerRequest.schemaBodyJson(SaveAgentRequest);
  return yield* HttpServerResponse.schemaJson(SaveAgentResponse)(yield* saveAgent({ ...body, agentId }));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ConfigFileInvalid: (error) => Effect.succeed(unprocessable(error.problems)),
    ConfigFileChanged: () =>
      Effect.succeed(conflict("The agent's file has changed since you opened it (on another machine, or by hand); look at it again before saving.")),
  }),
  Effect.catch(internalError("save agent")),
);
