import type { RebuildIndexRequest } from "@wiki-agents/contracts/indexing/rebuild-index/request";
import type { RebuildIndexResponse } from "@wiki-agents/contracts/indexing/rebuild-index/response";
import { Effect } from "effect";
import { findVault } from "../../vaults/find-vault.js";
import { Indexer } from "../indexer.js";
import { VaultIndex } from "../vault-index.js";

/** Drops the vault's index and rebuilds it from disk, waiting until it is done. */
export const rebuildIndex = Effect.fn("rebuildIndex")(function* (request: RebuildIndexRequest) {
  const vault = yield* findVault(request.vaultId);
  yield* (yield* Indexer).run({ _tag: "Rebuild", vault });
  const response: RebuildIndexResponse = yield* (yield* VaultIndex).counts(vault.id);
  return response;
});
