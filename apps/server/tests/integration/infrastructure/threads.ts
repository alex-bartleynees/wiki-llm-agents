import { GetThreadResponse } from "@wiki-agents/contracts/threads/get-thread/response";
import { CreateThreadResponse } from "@wiki-agents/contracts/threads/create-thread/response";
import type { RequestAnswer, StoredThreadEvent, ThreadEvent } from "@wiki-agents/contracts/threads/model";
import { SendMessageResponse } from "@wiki-agents/contracts/threads/send-message/response";
import { RegisterVaultResponse } from "@wiki-agents/contracts/vaults/register-vault/response";
import { type Duration, Effect, Fiber, PubSub, type Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import { ThreadBus } from "../../../src/features/threads/thread-bus.js";
import { makeTestVault } from "./test-vault.js";

/** Thread API calls and event watching shared by the thread and provider tests. */

/** Longer than any replay transcript takes. */
export const PLAY_ALL = "10 minutes";

export const decode = <A>(schema: Schema.ConstraintDecoder<A>) => (response: HttpClientResponse.HttpClientResponse) =>
  HttpClientResponse.filterStatusOk(response).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)));

export const post = (path: string, body: unknown) =>
  HttpClient.execute(HttpClientRequest.post(path).pipe(HttpClientRequest.bodyJsonUnsafe(body)));

export const newVaultWith = (files: Readonly<Record<string, string>>) => Effect.gen(function* () {
  const { root } = yield* makeTestVault({ files });
  const { vault } = yield* post("/api/vaults", { rootPath: root }).pipe(Effect.flatMap(decode(RegisterVaultResponse)));
  return { ...vault, rootPath: root };
});

export const newVault = newVaultWith({ "index.md": "# Home" });

export const newThread = (vaultId: string, providerInstanceId?: string) =>
  post(`/api/vaults/${vaultId}/threads`, providerInstanceId === undefined ? {} : { providerInstanceId }).pipe(
    Effect.flatMap(decode(CreateThreadResponse)),
    Effect.map((response) => response.thread),
  );

export const send = (threadId: string, text: string) => post(`/api/threads/${threadId}/messages`, { text });
export const sendOk = (threadId: string, text: string) =>
  send(threadId, text).pipe(
    Effect.flatMap(decode(SendMessageResponse)),
    Effect.map((response) => response.turnId),
  );
export const interrupt = (threadId: string) => post(`/api/threads/${threadId}/interrupt`, {});
export const answer = (threadId: string, requestId: string, value: RequestAnswer) =>
  post(`/api/threads/${threadId}/requests/${encodeURIComponent(requestId)}`, { answer: value });

export const getThread = (threadId: string) => HttpClient.get(`/api/threads/${threadId}`).pipe(Effect.flatMap(decode(GetThreadResponse)));
export const tags = (events: ReadonlyArray<StoredThreadEvent>) => events.map((stored) => stored.event._tag);

/**
 * Subscribes to the thread's events now; `until` then plays the replay forward on
 * the test clock (by `advance`) and collects events up to the first one matching `done`.
 */
export const watch = (threadId: string) =>
  Effect.gen(function* () {
    const subscription = yield* (yield* ThreadBus).subscribeEvents;
    const until = (done: (event: ThreadEvent) => boolean, advance: Duration.Input = PLAY_ALL) =>
      Effect.gen(function* () {
        const collect = Effect.gen(function* () {
          const seen: Array<ThreadEvent> = [];
          while (true) {
            const stored = yield* PubSub.take(subscription);
            if (stored.threadId !== threadId) continue;
            seen.push(stored.event);
            if (done(stored.event)) return seen;
          }
        });
        const fiber = yield* Effect.forkChild(collect);
        yield* TestClock.adjust(advance);
        return yield* Fiber.join(fiber);
      });
    return { until };
  });

export const isTag = (tag: ThreadEvent["_tag"]) => (event: ThreadEvent) => event._tag === tag;

export const requestIdOf = (events: ReadonlyArray<ThreadEvent>) => {
  const opened = events.find((event) => event._tag === "request.opened");
  if (opened?._tag !== "request.opened") throw new Error("no request was opened");
  return opened.requestId;
};

export const status = (threadId: string) => Effect.map(getThread(threadId), (response) => response.thread.status);
