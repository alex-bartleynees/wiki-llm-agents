import { SnoozeItemParams, SnoozeItemRequest } from "@wiki-agents/contracts/inbox/snooze-item/request";
import { SnoozeItemResponse } from "@wiki-agents/contracts/inbox/snooze-item/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { snoozeItem } from "./use-case.js";

export const snoozeItemEndpoint = Effect.gen(function* () {
  const { itemId } = yield* HttpRouter.schemaPathParams(SnoozeItemParams);
  const request = yield* HttpServerRequest.schemaBodyJson(SnoozeItemRequest);
  const response: SnoozeItemResponse = { item: yield* snoozeItem(itemId, request) };
  return yield* HttpServerResponse.schemaJson(SnoozeItemResponse)(response);
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    InvalidSnooze: (error) => Effect.succeed(badRequest(error.message)),
    InboxItemNotFound: () => Effect.succeed(notFound("Inbox item not found")),
  }),
  Effect.catch(internalError("snooze inbox item")),
);
