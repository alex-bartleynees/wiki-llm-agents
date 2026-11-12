import type { InboxItem } from "@wiki-agents/contracts/inbox/model";
import { ListInboxResponse } from "@wiki-agents/contracts/inbox/list-inbox/response";
import { CreateScheduleResponse } from "@wiki-agents/contracts/schedules/create-schedule/response";
import { GetScheduleResponse } from "@wiki-agents/contracts/schedules/get-schedule/response";
import { Effect, Fiber, PubSub } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { TestClock } from "effect/testing";
import type { ThreadEvent } from "@wiki-agents/contracts/threads/model";
import { InboxBus } from "../../../src/features/inbox/inbox-bus.js";
import { ThreadBus } from "../../../src/features/threads/thread-bus.js";
import { decode, post } from "./threads.js";

/** Schedule and inbox API calls, and waiting for inbox items, for the schedule tests. */

export const AKL = "Pacific/Auckland";
export const DAY = 86_400_000;

export const createSchedule = (body: Record<string, unknown>) =>
  post("/api/schedules", body).pipe(
    Effect.flatMap(decode(CreateScheduleResponse)),
    Effect.map((response) => response.schedule),
  );

export const getSchedule = (scheduleId: string) =>
  HttpClient.get(`/api/schedules/${scheduleId}`).pipe(
    Effect.flatMap(decode(GetScheduleResponse)),
    Effect.map((response) => response.schedule),
  );

export const patch = (path: string, body: unknown) => HttpClient.execute(HttpClientRequest.patch(path).pipe(HttpClientRequest.bodyJsonUnsafe(body)));
export const del = (path: string) => HttpClient.execute(HttpClientRequest.delete(path));

export const inbox = HttpClient.get("/api/inbox").pipe(
  Effect.flatMap(decode(ListInboxResponse)),
  Effect.map((response) => response.items),
);

export const itemsOf = (scheduleId: string) => Effect.map(inbox, (items) => items.filter((item) => item.source.scheduleId === scheduleId));

/**
 * Subscribes to inbox updates now; `until` runs `act` (moving the clock, say) and
 * returns the first update matching `done`, or one already in the inbox.
 */
export const watchInbox = Effect.gen(function* () {
  const subscription = yield* (yield* InboxBus).subscribe;
  const until = <E, R>(done: (item: InboxItem) => boolean, act: Effect.Effect<unknown, E, R> = Effect.void) =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Effect.gen(function* () {
          while (true) {
            const item = yield* PubSub.take(subscription);
            if (done(item)) return item;
          }
        }),
      );
      yield* act;
      const already = (yield* inbox).find(done);
      if (already !== undefined) {
        yield* Fiber.interrupt(fiber);
        return already;
      }
      return yield* Fiber.join(fiber);
    });
  return { until };
});

/** Moves the test clock to `at` (forward only), waking what was waiting for it. */
export const advanceTo = (at: number) => TestClock.setTime(at);

export const ofKind = (scheduleId: string, kind: InboxItem["kind"]) => (item: InboxItem) => item.source.scheduleId === scheduleId && item.kind === kind;

/** Runs `act`, then waits for the first event in the thread matching `done` (subscribed before `act`). */
export const threadEvent = <E, R>(threadId: string, done: (event: ThreadEvent) => boolean, act: Effect.Effect<unknown, E, R>) =>
  Effect.gen(function* () {
    const subscription = yield* (yield* ThreadBus).subscribeEvents;
    const fiber = yield* Effect.forkChild(
      Effect.gen(function* () {
        while (true) {
          const stored = yield* PubSub.take(subscription);
          if (stored.threadId === threadId && done(stored.event)) return stored.event;
        }
      }),
    );
    yield* act;
    return yield* Fiber.join(fiber);
  });
