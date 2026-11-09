import { GetNoteRequest } from "@wiki-agents/contracts/notes/get-note/request";
import { GetNoteResponse } from "@wiki-agents/contracts/notes/get-note/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { getNote } from "./use-case.js";

export const getNoteEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaParams(GetNoteRequest);
  return yield* HttpServerResponse.schemaJson(GetNoteResponse)(yield* getNote(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    InvalidVaultPath: () => Effect.succeed(badRequest("Invalid note path")),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
    VaultFileNotFound: () => Effect.succeed(notFound("Note not found")),
  }),
  Effect.catch(internalError("get note")),
);
