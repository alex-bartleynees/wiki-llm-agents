import { Schema } from "effect";
import { StoredThreadEvent, ThreadSummary } from "./model.js";

/** Sent first on every thread stream, once the server is subscribed. */
export const ThreadStreamReady = Schema.Struct({
  type: Schema.Literal("ready"),
});

/** A stored thread event; the SSE frame's `id` is its `seq`. */
export const ThreadStreamEvent = Schema.Struct({
  type: Schema.Literal("event"),
  event: StoredThreadEvent,
});

/** Events on GET /events/threads/:threadId, one JSON object per SSE `data:` line. */
export const ThreadStreamMessage = Schema.Union([ThreadStreamReady, ThreadStreamEvent]);
export type ThreadStreamMessage = typeof ThreadStreamMessage.Type;

/** A thread was created, or its title or status changed. */
export const ThreadUpdated = Schema.Struct({
  type: Schema.Literal("thread.updated"),
  thread: ThreadSummary,
});
export type ThreadUpdated = typeof ThreadUpdated.Type;

/** Events on GET /events/vaults/:vaultId/threads and GET /events/threads. No replay: reload the list after a reconnect. */
export const ThreadsStreamMessage = Schema.Union([ThreadStreamReady, ThreadUpdated]);
export type ThreadsStreamMessage = typeof ThreadsStreamMessage.Type;
