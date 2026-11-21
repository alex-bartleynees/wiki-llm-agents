import { UpdateInactivityPolicyRequest } from "@wiki-agents/contracts/threads/update-inactivity-policy/request";
import { UpdateInactivityPolicyResponse } from "@wiki-agents/contracts/threads/update-inactivity-policy/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError } from "../../../shared/http-errors.js";
import { ThreadRepository } from "../repository.js";

export const updateInactivityPolicyEndpoint = Effect.gen(function* () {
  const { policy } = yield* HttpServerRequest.schemaBodyJson(UpdateInactivityPolicyRequest);
  yield* (yield* ThreadRepository).saveInactivityPolicy(policy);
  return yield* HttpServerResponse.schemaJson(UpdateInactivityPolicyResponse)({ policy });
}).pipe(
  Effect.catchTags({ SchemaError: () => Effect.succeed(badRequest()), HttpServerError: () => Effect.succeed(badRequest()) }),
  Effect.catch(internalError("update thread inactivity policy")),
);
