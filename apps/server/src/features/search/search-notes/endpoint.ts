import { SearchNotesRequest } from "@wiki-agents/contracts/search/search-notes/request";
import { SearchNotesResponse } from "@wiki-agents/contracts/search/search-notes/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { searchNotes } from "./use-case.js";

export const searchNotesEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaParams(SearchNotesRequest);
  return yield* HttpServerResponse.schemaJson(SearchNotesResponse)(yield* searchNotes(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
  }),
  Effect.catch(internalError("search notes")),
);
