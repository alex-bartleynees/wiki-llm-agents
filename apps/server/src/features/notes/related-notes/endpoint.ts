import { RelatedNotesRequest } from "@wiki-agents/contracts/notes/related-notes/request";
import { RelatedNotesResponse } from "@wiki-agents/contracts/notes/related-notes/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { relatedNotes } from "../../search/related.js";
import { findVault } from "../../vaults/find-vault.js";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
export const relatedNotesEndpoint = Effect.gen(function* () {
  const { vaultId } = yield* HttpRouter.schemaPathParams(Schema.Struct({ vaultId: Schema.String }));
  const { path } = yield* HttpServerRequest.schemaSearchParams(RelatedNotesRequest);
  yield* findVault(vaultId);
  return yield* HttpServerResponse.schemaJson(RelatedNotesResponse)({ notes: (yield* relatedNotes(vaultId, path)).slice(0, 10) });
}).pipe(Effect.catchTags({ SchemaError: () => Effect.succeed(badRequest()), VaultNotFound: () => Effect.succeed(notFound("Vault not found")) }), Effect.catch(internalError("related notes")));
