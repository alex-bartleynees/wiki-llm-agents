import { ListTagsRequest } from "@wiki-agents/contracts/search/list-tags/request";
import { ListTagsResponse } from "@wiki-agents/contracts/search/list-tags/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { listTags } from "./use-case.js";

export const listTagsEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaParams(ListTagsRequest);
  return yield* HttpServerResponse.schemaJson(ListTagsResponse)(yield* listTags(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
  }),
  Effect.catch(internalError("list tags")),
);
