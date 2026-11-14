import type { ThreadsStreamMessage } from "@wiki-agents/contracts/threads/event";
import type { StreamThreadsRequest } from "@wiki-agents/contracts/threads/stream-threads/request";
import { Effect, Stream } from "effect";
import { findVault } from "../../vaults/find-vault.js";
import { ThreadBus } from "../thread-bus.js";

/** Changes to the vault's threads (new, renamed, status); `ready` once subscribed. */
export const streamThreads = Effect.fn("streamThreads")(function* (request: StreamThreadsRequest) {
  const vault = yield* findVault(request.vaultId);
  const bus = yield* ThreadBus;
  return Stream.unwrap(
    Effect.map(bus.subscribeThreads, (subscription) =>
      Stream.concat(
        Stream.succeed<ThreadsStreamMessage>({ type: "ready" }),
        Stream.fromSubscription(subscription).pipe(
          Stream.filter((thread) => thread.vaultId === vault.id),
          Stream.map((thread): ThreadsStreamMessage => ({ type: "thread.updated", thread })),
        ),
      ),
    ),
  );
});
