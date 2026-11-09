import type { GetBacklinksRequest } from "@wiki-agents/contracts/notes/get-backlinks/request";
import type { GetBacklinksResponse } from "@wiki-agents/contracts/notes/get-backlinks/response";
import { Effect } from "effect";
import { normaliseVaultPath } from "../../../shared/vault/path-guard.js";
import { InvalidVaultPath } from "../../../shared/vault/errors.js";
import { VaultIndex } from "../../indexing/vault-index.js";
import { findVault } from "../../vaults/find-vault.js";

/** Backlinks come from the index alone; the file itself needn't exist (an unresolved target). */
export const getBacklinks = Effect.fn("getBacklinks")(function* (request: GetBacklinksRequest) {
  const vault = yield* findVault(request.vaultId);
  const path = normaliseVaultPath(request.path);
  if (path === undefined) return yield* new InvalidVaultPath({ path: request.path });
  const response: GetBacklinksResponse = { backlinks: yield* (yield* VaultIndex).backlinks(vault.id, path) };
  return response;
});
