import { MarkItemDoneRequest } from "@wiki-agents/contracts/inbox/mark-item-done/request";
import { MarkItemDoneResponse } from "@wiki-agents/contracts/inbox/mark-item-done/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { setItemState } from "../set-state.js";

export const markItemDoneEndpoint = Effect.gen(function* () {
  const { itemId } = yield* HttpRouter.schemaPathParams(MarkItemDoneRequest);
  const response: MarkItemDoneResponse = { item: yield* setItemState(itemId, "done") };
  return yield* HttpServerResponse.schemaJson(MarkItemDoneResponse)(response);
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    InboxItemNotFound: () => Effect.succeed(notFound("Inbox item not found")),
  }),
  Effect.catch(internalError("mark done inbox item")),
);
