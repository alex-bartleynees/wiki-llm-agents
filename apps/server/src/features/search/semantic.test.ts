import { createServer, type RequestListener } from "node:http";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";
import { searchPaths } from "./semantic.js";

const serve = (listener: RequestListener) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const server = createServer(listener);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      return server;
    }),
    (server) => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  ).pipe(
    Effect.map((server) => {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Expected a TCP address");
      return "http://127.0.0.1:" + address.port;
    }),
  );

for (const stage of ["headers", "body"] as const) {
  it.effect(`gives up and closes the connection when rag-ai stalls before its ${stage}`, () =>
    Effect.gen(function* () {
      const stalled = yield* Deferred.make<void>();
      const closed = yield* Deferred.make<void>();
      const url = yield* serve((request, response) => {
        request.socket.on("close", () => Effect.runSync(Deferred.succeed(closed, undefined)));
        if (stage === "body") {
          response.writeHead(200, { "content-type": "application/json" });
          response.write("[");
        }
        Effect.runSync(Deferred.succeed(stalled, undefined));
      });
      const searching = yield* Effect.forkChild(searchPaths(url, "slow", 5), { startImmediately: true });
      yield* Deferred.await(stalled);
      yield* TestClock.adjust("3 seconds");
      expect(Option.isNone(yield* Fiber.join(searching))).toBe(true);
      yield* Deferred.await(closed);
    }),
  );
}

it.effect("refuses a rag-ai URL that isn't HTTP", () =>
  Effect.gen(function* () {
    expect(Option.isNone(yield* searchPaths("file:///tmp", "query", 5))).toBe(true);
    expect(Option.isNone(yield* searchPaths("not a url", "query", 5))).toBe(true);
  }),
);
