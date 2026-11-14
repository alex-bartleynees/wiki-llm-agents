import type { VaultEvent } from "@wiki-agents/contracts/indexing/event";
import { Effect, Stream } from "effect";
import { findVault } from "../../vaults/find-vault.js";
import { Indexer } from "../indexer.js";

/**
 * The `vault` topic: the vault's change events. Subscribes before sending `ready`, so a client that
 * waits for `ready` never misses a change.
 */
export const streamVaultEvents = Effect.fn("streamVaultEvents")(function* (request: { readonly vaultId: string }) {
  const vault = yield* findVault(request.vaultId);
  const indexer = yield* Indexer;
  return Stream.unwrap(
    Effect.map(indexer.subscribe, (subscription) =>
      Stream.concat(
        Stream.succeed<VaultEvent>({ type: "ready" }),
        Stream.fromSubscription(subscription).pipe(Stream.filter((event) => event.vaultId === vault.id)),
      ),
    ),
  );
});
