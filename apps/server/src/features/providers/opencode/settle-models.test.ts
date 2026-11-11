import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, PubSub } from "effect";
import { TestClock } from "effect/testing";
import type { OpenCodeEvent, OpenCodeSignal } from "./api.js";
import { settleModels } from "./server.js";

const options = { quiet: "1500 millis", max: "6 seconds" } as const;
const event = (type: string, directory?: string): OpenCodeSignal => ({
  _tag: "event",
  event: { id: "evt", created: 0, type, data: {}, ...(directory === undefined ? {} : { location: { directory } }) } as unknown as OpenCodeEvent,
});

/** A hub, a subscription to it, and `settleModels` running on that subscription. */
const settling = (directory: string) =>
  Effect.gen(function* () {
    const hub = yield* PubSub.unbounded<OpenCodeSignal>();
    const subscription = yield* PubSub.subscribe(hub);
    const fiber = yield* settleModels(subscription, directory, options).pipe(Effect.forkScoped);
    yield* Effect.yieldNow;
    return { hub, fiber };
  });

describe("settleModels", () => {
  it.effect("ends after the quiet time, unchanged, when no model event comes", () =>
    Effect.gen(function* () {
      const { fiber } = yield* settling("/vault");
      yield* TestClock.adjust("1499 millis");
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust("1 millis");
      expect(yield* Fiber.join(fiber)).toBe(false);
    }),
  );

  it.effect("waits out a late model update for the folder, such as GitHub Copilot's models arriving", () =>
    Effect.gen(function* () {
      const { hub, fiber } = yield* settling("/vault");
      yield* TestClock.adjust("1 second");
      yield* PubSub.publish(hub, event("model.updated", "/vault"));
      // The quiet time starts again from the update.
      yield* TestClock.adjust("1400 millis");
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust("100 millis");
      expect(yield* Fiber.join(fiber)).toBe(true);
    }),
  );

  it.effect("counts the catalogue refresh, which has no folder, but not other folders' or other events", () =>
    Effect.gen(function* () {
      const { hub, fiber } = yield* settling("/vault");
      yield* PubSub.publish(hub, event("model.updated", "/project"));
      yield* PubSub.publish(hub, event("session.updated", "/vault"));
      yield* TestClock.adjust("1500 millis");
      expect(yield* Fiber.join(fiber)).toBe(false);

      const second = yield* settling("/vault");
      yield* PubSub.publish(second.hub, event("models-dev.refreshed"));
      yield* TestClock.adjust("1500 millis");
      expect(yield* Fiber.join(second.fiber)).toBe(true);
    }),
  );

  it.effect("gives up after the longest wait even while updates keep coming", () =>
    Effect.gen(function* () {
      const { hub, fiber } = yield* settling("/vault");
      for (let elapsed = 0; elapsed < 6000; elapsed += 1000) {
        yield* PubSub.publish(hub, event("provider.updated", "/vault"));
        yield* TestClock.adjust("1 second");
      }
      expect(yield* Fiber.join(fiber)).toBe(true);
    }),
  );
});
