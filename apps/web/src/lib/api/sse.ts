import { EventStreamFrame } from "@wiki-agents/contracts/events/event";
import type { EventTopic } from "@wiki-agents/contracts/events/model";
import { SubscribeRequest } from "@wiki-agents/contracts/events/subscribe/request";
import { SubscribeResponse } from "@wiki-agents/contracts/events/subscribe/response";
import { UnsubscribeResponse } from "@wiki-agents/contracts/events/unsubscribe/response";
import { Schema } from "effect";
import { deleteJson, postJson } from "./client.ts";

/** Waits before reopening a stream the browser gave up on: 1 s, doubling up to 30 s. */
const RETRY_MS = { first: 1000, max: 30_000 } as const;

const decodeFrame = Schema.decodeUnknownSync(Schema.fromJsonString(EventStreamFrame));

interface Listener {
  readonly topic: () => EventTopic;
  readonly onMessage: (message: unknown) => void;
  readonly onReconnect: (() => void) | undefined;
  /** The connection this listener is subscribed on (or subscribing). */
  connectionId: string | undefined;
  /** Subscribed before, so a new subscription may have missed messages. */
  subscribedBefore: boolean;
}

/**
 * The tab's one event stream (GET /events), carrying every store's topic. Over
 * HTTP/1.1 a browser allows six connections per host across all tabs, so a stream per
 * store ran out with two tabs open and further requests hung.
 *
 * The stream starts with a connection id; each listener subscribes with a POST and
 * unsubscribes with a DELETE, so following another thread doesn't reopen anything.
 * A reconnect gets a new id and subscribes everything again.
 */
class EventHub {
  readonly #listeners = new Map<string, Listener>();
  #source: EventSource | undefined;
  #connectionId: string | undefined;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #delay: number = RETRY_MS.first;
  #next = 0;

  add(listener: Omit<Listener, "connectionId" | "subscribedBefore">): () => void {
    const subscriptionId = `s${++this.#next}`;
    const entry: Listener = { ...listener, connectionId: undefined, subscribedBefore: false };
    this.#listeners.set(subscriptionId, entry);
    if (this.#source === undefined && this.#retry === undefined) this.#open();
    else if (this.#connectionId !== undefined) this.#subscribe(subscriptionId, entry, this.#connectionId);
    return () => this.#remove(subscriptionId);
  }

  #remove(subscriptionId: string) {
    const entry = this.#listeners.get(subscriptionId);
    if (entry === undefined) return;
    this.#listeners.delete(subscriptionId);
    const connectionId = entry.connectionId;
    if (connectionId !== undefined && connectionId === this.#connectionId) {
      // Gone already if the stream dropped; nothing more to do either way.
      void deleteJson(`${subscriptionsPath(connectionId)}/${encodeURIComponent(subscriptionId)}`, UnsubscribeResponse).catch(() => {});
    }
    if (this.#listeners.size === 0) this.#close();
  }

  #subscribe(subscriptionId: string, entry: Listener, connectionId: string) {
    entry.connectionId = connectionId;
    const reconnected = entry.subscribedBefore;
    entry.subscribedBefore = true;
    postJson(subscriptionsPath(connectionId), SubscribeRequest, { subscriptionId, topic: entry.topic() }, SubscribeResponse).then(
      // Subscribed again: what was sent in between is lost, so the listener reloads.
      () => {
        if (reconnected && this.#listeners.get(subscriptionId) === entry && entry.connectionId === connectionId) entry.onReconnect?.();
      },
      // A dropped stream subscribes everything again once it is back.
      (error: unknown) => {
        if (connectionId === this.#connectionId) console.warn("Couldn't follow server events", error);
      },
    );
  }

  #open() {
    this.#retry = undefined;
    const source = (this.#source = new EventSource("/events"));
    source.addEventListener("open", () => {
      this.#delay = RETRY_MS.first;
    });
    source.addEventListener("message", (event: MessageEvent<string>) => {
      if (source !== this.#source) return;
      let frame: EventStreamFrame;
      try {
        frame = decodeFrame(event.data);
      } catch (error) {
        console.warn("Ignoring an event that doesn't match the contract", error);
        return;
      }
      if (frame.type === "connected") {
        this.#connectionId = frame.connectionId;
        for (const [subscriptionId, entry] of this.#listeners) this.#subscribe(subscriptionId, entry, frame.connectionId);
        return;
      }
      const entry = this.#listeners.get(frame.subscriptionId);
      if (entry !== undefined && entry.connectionId === this.#connectionId) entry.onMessage(frame.message);
    });
    // EventSource retries a dropped connection by itself (a new connection id follows),
    // but gives up for good after a response that isn't an event stream (a proxy's 502
    // while the server restarts); then open a new one after a backoff.
    source.addEventListener("error", () => {
      if (source !== this.#source) return;
      this.#connectionId = undefined;
      if (source.readyState !== EventSource.CLOSED) return;
      this.#source = undefined;
      this.#retry = setTimeout(() => this.#open(), this.#delay);
      this.#delay = Math.min(this.#delay * 2, RETRY_MS.max);
    });
  }

  #close() {
    clearTimeout(this.#retry);
    this.#retry = undefined;
    this.#source?.close();
    this.#source = undefined;
    this.#connectionId = undefined;
    this.#delay = RETRY_MS.first;
  }
}

const subscriptionsPath = (connectionId: string) => `/api/events/${encodeURIComponent(connectionId)}/subscriptions`;

const hub = new EventHub();

/**
 * Follows a topic on the tab's event stream, decoding each message with the topic's
 * schema. `onReconnect` runs after the stream comes back and the topic is followed
 * again, since a topic without replay loses the messages sent while it was away.
 *
 * A function `topic` is called again for each new subscription, so a topic with
 * replay can ask to resume from what it has. Returns a function that stops following.
 */
export const listen = <S extends Schema.ConstraintDecoder<unknown>>(
  topic: EventTopic | (() => EventTopic),
  schema: S,
  handlers: { readonly onEvent: (event: S["Type"]) => void; readonly onReconnect?: () => void },
): (() => void) => {
  const decode = Schema.decodeUnknownSync(schema);
  return hub.add({
    topic: typeof topic === "function" ? topic : () => topic,
    onMessage: (message) => {
      let event: S["Type"];
      try {
        event = decode(message) as S["Type"];
      } catch (error) {
        console.warn("Ignoring an event that doesn't match the contract", error);
        return;
      }
      handlers.onEvent(event);
    },
    onReconnect: handlers.onReconnect,
  });
};
