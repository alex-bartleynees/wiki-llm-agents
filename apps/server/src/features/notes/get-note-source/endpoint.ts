import { GetNoteSourceRequest } from "@wiki-agents/contracts/notes/get-note-source/request";
import { GetNoteSourceResponse } from "@wiki-agents/contracts/notes/get-note-source/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { getNoteSource } from "./use-case.js";

export const getNoteSourceEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaParams(GetNoteSourceRequest);
  return yield* HttpServerResponse.schemaJson(GetNoteSourceResponse)(yield* getNoteSource(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    InvalidVaultPath: () => Effect.succeed(badRequest("Invalid note path")),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
    VaultFileNotFound: () => Effect.succeed(notFound("Note not found")),
  }),
  Effect.catch(internalError("get note source")),
);
