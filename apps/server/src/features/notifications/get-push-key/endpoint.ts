import { GetPushKeyRequest } from "@wiki-agents/contracts/notifications/get-push-key/request";
import { GetPushKeyResponse } from "@wiki-agents/contracts/notifications/get-push-key/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError } from "../../../shared/http-errors.js";
import { PushSender } from "../push-sender.js";

export const getPushKeyEndpoint = Effect.gen(function* () {
  yield* HttpServerRequest.schemaSearchParams(GetPushKeyRequest);
  const response: GetPushKeyResponse = { publicKey: (yield* PushSender).publicKey };
  return yield* HttpServerResponse.schemaJson(GetPushKeyResponse)(response);
}).pipe(
  Effect.catchTags({ SchemaError: () => Effect.succeed(badRequest()) }),
  Effect.catch(internalError("get push key")),
);
