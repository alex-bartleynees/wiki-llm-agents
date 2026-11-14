import { Schema } from "effect";

/** The inbox: `InboxStreamMessage`s. */
export const InboxTopic = Schema.Struct({ type: Schema.Literal("inbox") });

/** Every thread in every vault (the Running view): `ThreadsStreamMessage`s. */
export const AllThreadsTopic = Schema.Struct({ type: Schema.Literal("all-threads") });

/** A vault's file changes: `VaultEvent`s. */
export const VaultTopic = Schema.Struct({ type: Schema.Literal("vault"), vaultId: Schema.String });

/** A vault's thread list: `ThreadsStreamMessage`s. */
export const VaultThreadsTopic = Schema.Struct({ type: Schema.Literal("vault-threads"), vaultId: Schema.String });

/**
 * One thread's events: `ThreadStreamMessage`s, the stored ones with a seq greater than
 * `after` first, then live ones. Subscribe again with the last seq you saw to resume.
 */
export const ThreadTopic = Schema.Struct({
  type: Schema.Literal("thread"),
  threadId: Schema.String,
  after: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

/** What a subscription on the event stream follows. Each topic's messages keep their own schema. */
export const EventTopic = Schema.Union([InboxTopic, AllThreadsTopic, VaultTopic, VaultThreadsTopic, ThreadTopic]);
export type EventTopic = typeof EventTopic.Type;
