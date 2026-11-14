import { EventStreamFrame } from "@wiki-agents/contracts/events/event";
import type { EventTopic } from "@wiki-agents/contracts/events/model";
import { Effect, Queue, Schema, Stream } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { post } from "./threads.js";

const decodeFrame = Schema.decodeUnknownSync(Schema.fromJsonString(EventStreamFrame));

/** A message on one subscription, as the browser gets it. */
export interface Delivered {
  readonly subscriptionId: string;
  readonly message: unknown;
}

/**
 * Opens `GET /events` for the rest of the scope, like one browser tab. `subscribe`
 * answers once the topic's `ready` is queued; `until` collects delivered messages up
 * to the first one matching `done`.
 */
export const openEvents = Effect.gen(function* () {
  const response = yield* HttpClient.get("/events");
  const frames = yield* Queue.unbounded<EventStreamFrame>();
  yield* response.stream.pipe(
    Stream.decodeText,
    Stream.splitLines,
    Stream.filter((line) => line.startsWith("data: ")),
    Stream.map((line) => decodeFrame(line.slice("data: ".length))),
    Stream.runForEach((frame) => Queue.offer(frames, frame)),
    Effect.forkScoped,
  );
  const first = yield* Queue.take(frames);
  if (first.type !== "connected") throw new Error("the stream didn't start with `connected`");
  const { connectionId } = first;

  const subscribe = (subscriptionId: string, topic: EventTopic) =>
    post(`/api/events/${connectionId}/subscriptions`, { subscriptionId, topic });
  const unsubscribe = (subscriptionId: string) =>
    HttpClient.execute(HttpClientRequest.delete(`/api/events/${connectionId}/subscriptions/${subscriptionId}`));
  const until = (done: (delivered: Delivered) => boolean) =>
    Effect.gen(function* () {
      const seen: Array<Delivered> = [];
      while (true) {
        const frame = yield* Queue.take(frames);
        if (frame.type !== "message") continue;
        seen.push(frame);
        if (done(frame)) return seen;
      }
    });
  return { status: response.status, contentType: response.headers["content-type"], connectionId, subscribe, unsubscribe, until };
});
