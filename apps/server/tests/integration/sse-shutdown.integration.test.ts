import { expect, layer } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { ServerClosing } from "../../src/shared/server-closing.js";
import { makeTestApp } from "./infrastructure/test-app.js";
import { newThread, newVault } from "./infrastructure/threads.js";

/** Stands in for the Node server starting to close. */
const closing = Deferred.makeUnsafe<void>();
const App = makeTestApp().pipe(Layer.provide(Layer.succeed(ServerClosing, Deferred.await(closing))));

layer(App)("event streams when the server starts closing", (it) => {
  it.effect("end, so closing doesn't wait for them", () =>
    Effect.gen(function* () {
      const vault = yield* newVault;
      const thread = yield* newThread(vault.id);
      const open = (path: string) =>
        Effect.flatMap(HttpClient.execute(HttpClientRequest.get(path)), (response) =>
          response.stream.pipe(Stream.decodeText, Stream.runCollect, Effect.map((chunks) => chunks.join(""))),
        );
      const paths = [`/events/vaults/${vault.id}`, `/events/vaults/${vault.id}/threads`, `/events/threads/${thread.id}?after=0`];
      const streams = yield* Effect.forkChild(Effect.forEach(paths, open, { concurrency: "unbounded" }));
      yield* Deferred.succeed(closing, undefined);
      // Each stream's body ends instead of running forever.
      expect(yield* Fiber.join(streams)).toHaveLength(3);
    }),
  );
});
