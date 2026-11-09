import { GetBacklinksRequest } from "@wiki-agents/contracts/notes/get-backlinks/request";
import { GetBacklinksResponse } from "@wiki-agents/contracts/notes/get-backlinks/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { getBacklinks } from "./use-case.js";

export const getBacklinksEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaParams(GetBacklinksRequest);
  return yield* HttpServerResponse.schemaJson(GetBacklinksResponse)(yield* getBacklinks(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    InvalidVaultPath: () => Effect.succeed(badRequest("Invalid path")),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
  }),
  Effect.catch(internalError("get backlinks")),
);
