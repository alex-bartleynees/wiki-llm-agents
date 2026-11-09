import type { Vault } from "@wiki-agents/contracts/vaults/model";
import { Effect } from "effect";
import { Indexer } from "./indexer.js";
import { VaultWatcher } from "./watcher.js";

/**
 * Keeps a vault's index current: start watching, then scan, so a change made during
 * the scan is still seen. Called when a vault is registered and for every vault at
 * startup. Resolves once the scan is done.
 */
export const trackVault = Effect.fn("trackVault")(function* (vault: Vault) {
  yield* (yield* VaultWatcher).watch(vault);
  yield* (yield* Indexer).run({ _tag: "Scan", vault });
});
