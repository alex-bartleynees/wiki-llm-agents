import { VaultEvent } from "@wiki-agents/contracts/indexing/event";
import type { StreamVaultEventsRequest } from "@wiki-agents/contracts/indexing/stream-vault-events/request";
import { Effect, Schema, Stream } from "effect";
import { sseFrame } from "../../../shared/sse.js";
import { findVault } from "../../vaults/find-vault.js";
import { Indexer } from "../indexer.js";

const encode = Schema.encodeSync(Schema.fromJsonString(VaultEvent));

/**
 * The vault's change events as SSE frames. Subscribes before sending `ready`, so a
 * client that waits for `ready` never misses a change.
 */
export const streamVaultEvents = Effect.fn("streamVaultEvents")(function* (request: StreamVaultEventsRequest) {
  const vault = yield* findVault(request.vaultId);
  const indexer = yield* Indexer;
  return Stream.unwrap(
    Effect.map(indexer.subscribe, (subscription) =>
      Stream.concat(
        Stream.succeed<VaultEvent>({ type: "ready" }),
        Stream.fromSubscription(subscription).pipe(Stream.filter((event) => event.vaultId === vault.id)),
      ),
    ),
  ).pipe(Stream.map((event) => sseFrame(encode(event))));
});
