import { DeleteAgentRequest } from "@wiki-agents/contracts/agents/delete-agent/request";
import { DeleteAgentResponse } from "@wiki-agents/contracts/agents/delete-agent/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { deleteAgent } from "./use-case.js";

export const deleteAgentEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaParams(DeleteAgentRequest);
  return yield* HttpServerResponse.schemaJson(DeleteAgentResponse)(yield* deleteAgent(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ConfigFileInvalid: () => Effect.succeed(badRequest("Invalid agent id")),
    ConfigFileNotFound: () => Effect.succeed(notFound("Agent not found")),
    ConfigFileChanged: () => Effect.succeed(conflict("The agent's file has changed since you opened it; look at it again before deleting.")),
  }),
  Effect.catch(internalError("delete agent")),
);
