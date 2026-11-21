import { GetInactivityPolicyRequest } from "@wiki-agents/contracts/threads/get-inactivity-policy/request";
import { GetInactivityPolicyResponse } from "@wiki-agents/contracts/threads/get-inactivity-policy/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError } from "../../../shared/http-errors.js";
import { ThreadRepository } from "../repository.js";

export const getInactivityPolicyEndpoint = Effect.gen(function* () {
  yield* HttpServerRequest.schemaSearchParams(GetInactivityPolicyRequest);
  const policy = yield* (yield* ThreadRepository).inactivityPolicy;
  return yield* HttpServerResponse.schemaJson(GetInactivityPolicyResponse)({ policy });
}).pipe(
  Effect.catchTags({ SchemaError: () => Effect.succeed(badRequest()) }),
  Effect.catch(internalError("get thread inactivity policy")),
);
