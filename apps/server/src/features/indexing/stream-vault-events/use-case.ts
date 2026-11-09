import { VaultEvent } from "@wiki-agents/contracts/indexing/event";
import type { StreamVaultEventsRequest } from "@wiki-agents/contracts/indexing/stream-vault-events/request";
import { Effect, Schema, Stream } from "effect";
import { findVault } from "../../vaults/find-vault.js";
import { Indexer } from "../indexer.js";

/** A comment line now and then keeps proxies and browsers from closing an idle stream. */
const HEARTBEAT = "25 seconds";

const encode = Schema.encodeSync(Schema.fromJsonString(VaultEvent));

/**
 * The vault's change events as SSE frames. Subscribes before sending `ready`, so a
 * client that waits for `ready` never misses a change.
 */
export const streamVaultEvents = Effect.fn("streamVaultEvents")(function* (request: StreamVaultEventsRequest) {
  const vault = yield* findVault(request.vaultId);
  const indexer = yield* Indexer;
  const events = Stream.unwrap(
    Effect.map(indexer.subscribe, (subscription) =>
      Stream.concat(
        Stream.succeed<VaultEvent>({ type: "ready" }),
        Stream.fromSubscription(subscription).pipe(Stream.filter((event) => event.vaultId === vault.id)),
      ),
    ),
  ).pipe(Stream.map((event) => `data: ${encode(event)}\n\n`));
  const heartbeat = Stream.tick(HEARTBEAT).pipe(Stream.map(() => ": keep-alive\n\n"));
  return Stream.merge(events, heartbeat, { haltStrategy: "left" });
});
