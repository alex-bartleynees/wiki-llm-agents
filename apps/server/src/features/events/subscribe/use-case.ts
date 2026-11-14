import type { EventTopic } from "@wiki-agents/contracts/events/model";
import { InboxStreamMessage } from "@wiki-agents/contracts/inbox/event";
import { VaultEvent } from "@wiki-agents/contracts/indexing/event";
import { ThreadsStreamMessage, ThreadStreamMessage } from "@wiki-agents/contracts/threads/event";
import { Effect, Schema, Stream } from "effect";
import { streamInbox } from "../../inbox/stream-inbox/use-case.js";
import { streamVaultEvents } from "../../indexing/stream-vault-events/use-case.js";
import { streamAllThreads } from "../../threads/stream-all-threads/use-case.js";
import { streamThreadEvents } from "../../threads/stream-thread-events/use-case.js";
import { streamThreads } from "../../threads/stream-threads/use-case.js";
import { EventConnections } from "../connections.js";

/** A topic's messages, encoded with its own schema for the envelope. */
const encoded = <S extends Schema.Codec<unknown, unknown>>(schema: S, messages: Stream.Stream<S["Type"]>): Stream.Stream<unknown> => {
  const encode = Schema.encodeSync(schema);
  return Stream.map(messages, (message) => encode(message));
};

/** The topic's messages; fails with `VaultNotFound` or `ThreadNotFound` for one that doesn't exist. */
const topicMessages = (topic: EventTopic) => {
  switch (topic.type) {
    case "inbox":
      return Effect.map(streamInbox, (messages) => encoded(InboxStreamMessage, messages));
    case "all-threads":
      return Effect.map(streamAllThreads(), (messages) => encoded(ThreadsStreamMessage, messages));
    case "vault":
      return Effect.map(streamVaultEvents({ vaultId: topic.vaultId }), (messages) => encoded(VaultEvent, messages));
    case "vault-threads":
      return Effect.map(streamThreads({ vaultId: topic.vaultId }), (messages) => encoded(ThreadsStreamMessage, messages));
    case "thread":
      return Effect.map(streamThreadEvents({ threadId: topic.threadId, after: topic.after }), (messages) =>
        encoded(ThreadStreamMessage, messages),
      );
  }
};

/** Follows `topic` on the connection as `subscriptionId`; returns once subscribed. */
export const subscribe = Effect.fn("subscribe")(function* (connectionId: string, subscriptionId: string, topic: EventTopic) {
  const connections = yield* EventConnections;
  const messages = yield* topicMessages(topic);
  yield* connections.subscribe(connectionId, subscriptionId, messages);
});
