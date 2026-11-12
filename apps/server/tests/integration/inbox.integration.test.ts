import { expect, layer } from "@effect/vitest";
import type { InboxItem } from "@wiki-agents/contracts/inbox/model";
import { MarkReadResponse } from "@wiki-agents/contracts/inbox/mark-read/response";
import { SnoozeItemResponse } from "@wiki-agents/contracts/inbox/snooze-item/response";
import { Clock, Effect, Layer, Queue } from "effect";
import { TestClock } from "effect/testing";
import { DeliveryChannels, DeliveryFailed, inAppChannel } from "../../src/features/inbox/delivery.js";
import { MAX_DELIVERY_ATTEMPTS } from "../../src/features/inbox/delivery-worker.js";
import { InboxBus } from "../../src/features/inbox/inbox-bus.js";
import { makeScriptedProvider } from "./infrastructure/scripted-provider.js";
import { AKL, createSchedule, inbox, ofKind, watchInbox, advanceTo } from "./infrastructure/schedules.js";
import { makeTestApp } from "./infrastructure/test-app.js";
import { answer, decode, newThread, newVault, post, sendOk } from "./infrastructure/threads.js";

const provider = makeScriptedProvider();
provider.scripts.set("Edit the plan", ({ turnId }) =>
  Effect.succeed([{ _tag: "request.opened", turnId, requestId: `${turnId}-edit`, prompt: { _tag: "approval", title: "Edit Plan.md", detail: "add a line" } }]),
);
provider.scripts.set("Say hello", ({ turnId }) => Effect.succeed([{ _tag: "message.delta", turnId, messageId: "m", text: "Hello there." }]));

const reminderNow = (text: string) =>
  Effect.gen(function* () {
    const schedule = yield* createSchedule({ kind: "reminder", text, recurrence: { _tag: "daily", time: "09:00" }, timezone: AKL });
    const watching = yield* watchInbox;
    return yield* watching.until(ofKind(schedule.id, "reminder"), post(`/api/schedules/${schedule.id}/run`, {}));
  });

const act = (item: InboxItem, action: "dismiss" | "done") => post(`/api/inbox/${item.id}/${action}`, {}).pipe(Effect.flatMap(decode(SnoozeItemResponse)), Effect.map((response) => response.item));

layer(makeTestApp({ providers: provider.registry }))("inbox", (it) => {
  it.effect("puts a waiting approval in the inbox and marks it done once answered", () =>
    Effect.gen(function* () {
      const vault = yield* newVault;
      const thread = yield* newThread(vault.id, "scripted");
      const watching = yield* watchInbox;
      const waiting = yield* watching.until((item) => item.kind === "request" && item.source.threadId === thread.id, sendOk(thread.id, "Edit the plan"));
      expect(waiting).toMatchObject({ title: "Approve: Edit Plan.md", body: "add a line", state: "open", source: { vaultId: vault.id, threadId: thread.id } });

      const done = yield* watching.until(
        (item) => item.id === waiting.id && item.state === "done",
        answer(thread.id, waiting.source.requestId!, { _tag: "approval", decision: "approve" }),
      );
      expect(done.resolution).toBe("Approved");
    }),
  );

  it.effect("keeps one item per thread for its latest turn, done when you go back to the thread", () =>
    Effect.gen(function* () {
      const thread = yield* newThread((yield* newVault).id, "scripted");
      const watching = yield* watchInbox;
      const finished = yield* watching.until((item) => item.kind === "turn.finished" && item.source.threadId === thread.id, sendOk(thread.id, "Say hello"));
      expect(finished).toMatchObject({ title: "Finished: Say hello", body: "Hello there." });

      const closed = yield* watching.until((item) => item.id === finished.id && item.state === "done", sendOk(thread.id, "Say hello"));
      expect(closed.state).toBe("done");
      const again = yield* watching.until((item) => item.kind === "turn.finished" && item.source.threadId === thread.id && item.state === "open", Effect.void);
      expect(again.id).not.toBe(finished.id);
      expect((yield* inbox).filter((item) => item.source.threadId === thread.id && item.state === "open")).toHaveLength(1);
    }),
  );

  it.effect("snoozes an item until later, when it comes back unread", () =>
    Effect.gen(function* () {
      const item = yield* reminderNow("Read the paper");
      const read = yield* post("/api/inbox/read", { itemIds: [item.id] }).pipe(Effect.flatMap(decode(MarkReadResponse)));
      expect(read.items).toEqual([expect.objectContaining({ id: item.id, read: true })]);

      const until = (yield* Clock.currentTimeMillis) + 60 * 60_000;
      const snoozed = yield* post(`/api/inbox/${item.id}/snooze`, { until }).pipe(Effect.flatMap(decode(SnoozeItemResponse)));
      expect(snoozed.item).toMatchObject({ snoozedUntil: until, read: false, state: "open" });
      expect((yield* post(`/api/inbox/${item.id}/snooze`, { until: 0 })).status).toBe(400);

      const watching = yield* watchInbox;
      const back = yield* watching.until((candidate) => candidate.id === item.id && candidate.snoozedUntil === null, advanceTo(until));
      expect(back).toMatchObject({ read: false, state: "open" });
    }),
  );

  it.effect("dismisses and marks items done", () =>
    Effect.gen(function* () {
      const first = yield* reminderNow("First");
      const second = yield* reminderNow("Second");
      expect(yield* act(first, "dismiss")).toMatchObject({ state: "dismissed" });
      expect(yield* act(second, "done")).toMatchObject({ state: "done" });
      const items = yield* inbox;
      const open = items.filter((item) => item.state === "open").map((item) => item.id);
      expect(open).not.toContain(first.id);
      expect(items.map((item) => item.id)).toContain(first.id);
      expect((yield* post("/api/inbox/nope/done", {})).status).toBe(404);
    }),
  );
});

/** A phone channel that fails its first two tries for each item, and always for "Unreachable". */
const sent = Effect.runSync(Queue.unbounded<string>());
const tries = new Map<string, number>();
const Phone = Layer.effect(
  DeliveryChannels,
  Effect.gen(function* () {
    const bus = yield* InboxBus;
    return [
      inAppChannel(bus),
      {
        id: "phone",
        deliver: (item: InboxItem) =>
          Effect.suspend(() => {
            const count = (tries.get(item.id) ?? 0) + 1;
            tries.set(item.id, count);
            if (item.title === "Unreachable" || count <= 2) return Effect.fail(new DeliveryFailed({ message: `no signal (try ${count})` }));
            return Queue.offer(sent, item.id);
          }),
      },
    ];
  }),
);

let runs = 0;
provider.scripts.set("Count me", ({ turnId }) =>
  Effect.sync(() => {
    runs++;
    return [{ _tag: "message.delta" as const, turnId, messageId: "m", text: "Counted." }];
  }),
);

layer(makeTestApp({ providers: provider.registry, channels: Phone }))("delivery", (it) => {
  /** Moves the clock in steps until `done`; retries wait seconds apart on the test clock. */
  const retryUntil = (done: Effect.Effect<boolean>) =>
    Effect.gen(function* () {
      for (let step = 0; step < 10 && !(yield* done); step++) yield* TestClock.adjust("10 seconds");
    });

  it.effect("retries a failed delivery without running the prompt again", () =>
    Effect.gen(function* () {
      const schedule = yield* createSchedule({
        kind: "prompt",
        text: "Count me",
        recurrence: { _tag: "daily", time: "09:00" },
        timezone: AKL,
        vaultId: (yield* newVault).id,
        providerInstanceId: "scripted",
      });
      const watching = yield* watchInbox;
      const item = yield* watching.until(ofKind(schedule.id, "prompt.result"), advanceTo(schedule.nextAt!));
      let delivered = false;
      yield* retryUntil(Effect.map(Queue.poll(sent), (id) => (delivered ||= id._tag === "Some" && id.value === item.id)));
      expect(delivered).toBe(true);
      expect(runs).toBe(1);
      const stored = (yield* inbox).find((candidate) => candidate.id === item.id)!;
      expect(stored.deliveries).toEqual([
        expect.objectContaining({ channel: "in-app", status: "sent", attempts: 1 }),
        expect.objectContaining({ channel: "phone", status: "sent", attempts: 3, lastError: null }),
      ]);
    }),
  );

  it.effect("gives up after the last try and shows the failure", () =>
    Effect.gen(function* () {
      const item = yield* reminderNow("Unreachable");
      const watching = yield* watchInbox;
      const failed = yield* watching.until(
        (candidate) => candidate.id === item.id && candidate.deliveries.some((delivery) => delivery.status === "failed"),
        retryUntil(Effect.succeed(false)),
      );
      expect(failed.deliveries.find((delivery) => delivery.channel === "phone")).toMatchObject({
        status: "failed",
        attempts: MAX_DELIVERY_ATTEMPTS,
        lastError: `no signal (try ${MAX_DELIVERY_ATTEMPTS})`,
      });
    }),
  );
});
