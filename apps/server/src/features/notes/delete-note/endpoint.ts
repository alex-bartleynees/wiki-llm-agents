import { DeleteNoteRequest } from "@wiki-agents/contracts/notes/delete-note/request";
import { DeleteNoteResponse } from "@wiki-agents/contracts/notes/delete-note/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { deleteNote } from "./use-case.js";

export const deleteNoteEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaParams(DeleteNoteRequest);
  return yield* HttpServerResponse.schemaJson(DeleteNoteResponse)(yield* deleteNote(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    InvalidVaultPath: () => Effect.succeed(badRequest("Invalid note path")),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
    VaultFileNotFound: () => Effect.succeed(notFound("Note not found")),
    NoteChangedOnDisk: () => Effect.succeed(conflict("The note has changed since you opened it; look at it again before deleting.")),
  }),
  Effect.catch(internalError("delete note")),
);
