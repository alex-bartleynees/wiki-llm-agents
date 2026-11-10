import { ListNoteContextRequest } from "@wiki-agents/contracts/threads/list-note-context/request";
import { ListNoteContextResponse } from "@wiki-agents/contracts/threads/list-note-context/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { findVault } from "../../vaults/find-vault.js";
import { ThreadRepository } from "../repository.js";
export const listNoteContextEndpoint = Effect.gen(function* () {
  const { vaultId, path } = yield* HttpRouter.schemaParams(ListNoteContextRequest);
  yield* findVault(vaultId);
  return yield* HttpServerResponse.schemaJson(ListNoteContextResponse)({ notes: yield* (yield* ThreadRepository).noteContext(vaultId, path) });
}).pipe(Effect.catchTags({ SchemaError: () => Effect.succeed(badRequest()), VaultNotFound: () => Effect.succeed(notFound("Vault not found")) }), Effect.catch(internalError("list note context")));
