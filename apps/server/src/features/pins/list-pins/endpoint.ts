import { ListPinsRequest } from "@wiki-agents/contracts/pins/list-pins/request";
import { ListPinsResponse } from "@wiki-agents/contracts/pins/list-pins/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { listPins } from "./use-case.js";

export const listPinsEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaParams(ListPinsRequest);
  return yield* HttpServerResponse.schemaJson(ListPinsResponse)(yield* listPins(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
  }),
  Effect.catch(internalError("list pins")),
);
