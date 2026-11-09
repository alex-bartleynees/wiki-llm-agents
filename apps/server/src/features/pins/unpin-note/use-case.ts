import type { UnpinNoteRequest } from "@wiki-agents/contracts/pins/unpin-note/request";
import type { UnpinNoteResponse } from "@wiki-agents/contracts/pins/unpin-note/response";
import { Effect } from "effect";
import { InvalidVaultPath } from "../../../shared/vault/errors.js";
import { normaliseVaultPath } from "../../../shared/vault/path-guard.js";
import { findVault } from "../../vaults/find-vault.js";
import { listVaultPins } from "../list.js";
import { PinRepository } from "../repository.js";

/** Unpins by path, whether or not the file still exists. */
export const unpinNote = Effect.fn("unpinNote")(function* (request: UnpinNoteRequest) {
  const vault = yield* findVault(request.vaultId);
  const path = normaliseVaultPath(request.path);
  if (path === undefined) return yield* new InvalidVaultPath({ path: request.path });
  yield* (yield* PinRepository).remove(vault.id, path);
  const response: UnpinNoteResponse = { pins: yield* listVaultPins(vault.id) };
  return response;
});
