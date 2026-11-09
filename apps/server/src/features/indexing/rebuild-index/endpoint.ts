import { RebuildIndexRequest } from "@wiki-agents/contracts/indexing/rebuild-index/request";
import { RebuildIndexResponse } from "@wiki-agents/contracts/indexing/rebuild-index/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { rebuildIndex } from "./use-case.js";

export const rebuildIndexEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaPathParams(RebuildIndexRequest);
  return yield* HttpServerResponse.schemaJson(RebuildIndexResponse)(yield* rebuildIndex(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
  }),
  Effect.catch(internalError("rebuild index")),
);
