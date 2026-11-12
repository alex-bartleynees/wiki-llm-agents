import type { GetNoteSourceRequest } from "@wiki-agents/contracts/notes/get-note-source/request";
import type { GetNoteSourceResponse } from "@wiki-agents/contracts/notes/get-note-source/response";
import { Effect } from "effect";
import { findVault } from "../../vaults/find-vault.js";
import { readNoteSource, requireNotePath } from "../note-source.js";

/** The note's markdown as it is on disk, with the hash a save must start from. */
export const getNoteSource = Effect.fn("getNoteSource")(function* (request: GetNoteSourceRequest) {
  const vault = yield* findVault(request.vaultId);
  yield* requireNotePath(request.path);
  const source = yield* readNoteSource(vault.rootPath, request.path);
  return {
    vaultId: vault.id,
    path: source.path,
    content: new TextDecoder().decode(source.bytes),
    hash: source.hash,
    modifiedAt: source.modifiedAt,
  } satisfies GetNoteSourceResponse;
});
