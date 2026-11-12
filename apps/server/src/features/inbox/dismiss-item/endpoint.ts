import { DismissItemRequest } from "@wiki-agents/contracts/inbox/dismiss-item/request";
import { DismissItemResponse } from "@wiki-agents/contracts/inbox/dismiss-item/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { setItemState } from "../set-state.js";

export const dismissItemEndpoint = Effect.gen(function* () {
  const { itemId } = yield* HttpRouter.schemaPathParams(DismissItemRequest);
  const response: DismissItemResponse = { item: yield* setItemState(itemId, "dismissed") };
  return yield* HttpServerResponse.schemaJson(DismissItemResponse)(response);
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    InboxItemNotFound: () => Effect.succeed(notFound("Inbox item not found")),
  }),
  Effect.catch(internalError("dismiss inbox item")),
);
