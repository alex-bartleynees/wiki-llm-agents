import type { PinNoteResponse } from "@wiki-agents/contracts/pins/pin-note/response";
import { Clock, Effect } from "effect";
import { InvalidVaultPath, VaultFileNotFound } from "../../../shared/vault/errors.js";
import { normaliseVaultPath } from "../../../shared/vault/path-guard.js";
import { VaultIndex } from "../../indexing/vault-index.js";
import { findVault } from "../../vaults/find-vault.js";
import { listVaultPins } from "../list.js";
import { PinRepository } from "../repository.js";

/** Pins a file the index knows about (so only visible files, never ignored or escaping paths). */
export const pinNote = Effect.fn("pinNote")(function* (request: { readonly vaultId: string; readonly path: string }) {
  const vault = yield* findVault(request.vaultId);
  const path = normaliseVaultPath(request.path);
  if (path === undefined) return yield* new InvalidVaultPath({ path: request.path });
  const files = yield* (yield* VaultIndex).titledFiles(vault.id);
  if (!files.some((file) => file.path === path)) return yield* new VaultFileNotFound({ path });
  yield* (yield* PinRepository).add(vault.id, path, new Date(yield* Clock.currentTimeMillis));
  const response: PinNoteResponse = { pins: yield* listVaultPins(vault.id, files) };
  return response;
});
