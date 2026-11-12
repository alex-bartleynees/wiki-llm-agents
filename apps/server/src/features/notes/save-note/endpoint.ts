import { SaveNoteRequest } from "@wiki-agents/contracts/notes/save-note/request";
import { SaveNoteResponse } from "@wiki-agents/contracts/notes/save-note/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { saveNote } from "./use-case.js";

const Params = Schema.Struct({ vaultId: Schema.String });

/** The vault comes from the route, the note and its content from the body. */
export const saveNoteEndpoint = Effect.gen(function* () {
  const { vaultId } = yield* HttpRouter.schemaPathParams(Params);
  const body = yield* HttpServerRequest.schemaBodyJson(SaveNoteRequest);
  return yield* HttpServerResponse.schemaJson(SaveNoteResponse)(yield* saveNote({ vaultId, ...body }));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    InvalidVaultPath: () => Effect.succeed(badRequest("Invalid note path")),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
    NoteChangedOnDisk: () => Effect.succeed(conflict("The note has changed on disk since you started editing it.")),
  }),
  Effect.catch(internalError("save note")),
);
