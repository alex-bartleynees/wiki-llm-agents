import { ListInboxRequest } from "@wiki-agents/contracts/inbox/list-inbox/request";
import { ListInboxResponse } from "@wiki-agents/contracts/inbox/list-inbox/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError } from "../../../shared/http-errors.js";
import { InboxRepository } from "../repository.js";

export const listInboxEndpoint = Effect.gen(function* () {
  yield* HttpServerRequest.schemaSearchParams(ListInboxRequest);
  const response: ListInboxResponse = { items: yield* (yield* InboxRepository).list };
  return yield* HttpServerResponse.schemaJson(ListInboxResponse)(response);
}).pipe(
  Effect.catchTags({ SchemaError: () => Effect.succeed(badRequest()) }),
  Effect.catch(internalError("list inbox")),
);
