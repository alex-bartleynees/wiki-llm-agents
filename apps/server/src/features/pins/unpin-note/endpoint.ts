import { UnpinNoteRequest } from "@wiki-agents/contracts/pins/unpin-note/request";
import { UnpinNoteResponse } from "@wiki-agents/contracts/pins/unpin-note/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { unpinNote } from "./use-case.js";

export const unpinNoteEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaParams(UnpinNoteRequest);
  return yield* HttpServerResponse.schemaJson(UnpinNoteResponse)(yield* unpinNote(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    InvalidVaultPath: () => Effect.succeed(badRequest("Invalid path")),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
  }),
  Effect.catch(internalError("unpin note")),
);
