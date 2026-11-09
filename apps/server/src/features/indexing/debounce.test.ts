import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { makeDebouncer, makePathBatcher } from "./debounce.js";

describe("makeDebouncer", () => {
  it.effect("runs only the last effect for a key, once the key is quiet", () =>
    Effect.gen(function* () {
      const debounce = yield* makeDebouncer("300 millis");
      const ran: Array<string> = [];
      const record = (label: string) => Effect.sync(() => void ran.push(label));

      yield* debounce("a.md", record("a: first save"));
      yield* TestClock.adjust("200 millis");
      yield* debounce("a.md", record("a: second save"));
      yield* debounce("b.md", record("b"));
      yield* TestClock.adjust("299 millis");
      expect(ran).toEqual([]);

      yield* TestClock.adjust("1 millis");
      expect(ran.sort()).toEqual(["a: second save", "b"]);
    }),
  );
});

it.effect("batches different paths per vault without waiting for a continuous sync to stop", () =>
  Effect.gen(function* () {
    const batch = yield* makePathBatcher("300 millis");
    const ran: Array<ReadonlyArray<string>> = [];
    const flush = (paths: ReadonlyArray<string>) => Effect.sync(() => void ran.push(paths));
    yield* batch("vault", "a.md", flush);
    yield* TestClock.adjust("200 millis");
    yield* batch("vault", "b.md", flush);
    yield* batch("vault", "a.md", flush);
    yield* TestClock.adjust("100 millis");
    expect(ran).toEqual([["a.md", "b.md"]]);
    yield* batch("vault", "c.md", flush);
    yield* TestClock.adjust("300 millis");
    expect(ran).toEqual([["a.md", "b.md"], ["c.md"]]);
  }),
);
