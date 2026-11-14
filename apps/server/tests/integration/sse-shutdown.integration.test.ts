import { expect, layer } from "@effect/vitest";
import { Deferred, Effect, Layer } from "effect";
import { ServerClosing } from "../../src/shared/server-closing.js";
import { openEvents } from "./infrastructure/events.js";
import { makeTestApp } from "./infrastructure/test-app.js";
import { newThread, newVault } from "./infrastructure/threads.js";

/** Stands in for the Node server starting to close. */
const closing = Deferred.makeUnsafe<void>();
const App = makeTestApp().pipe(Layer.provide(Layer.succeed(ServerClosing, Deferred.await(closing))));

layer(App)("event streams when the server starts closing", (it) => {
  it.effect("end, with every topic followed, so closing doesn't wait for them", () =>
    Effect.gen(function* () {
      const vault = yield* newVault;
      const thread = yield* newThread(vault.id);
      const events = yield* openEvents;
      yield* events.subscribe("inbox", { type: "inbox" });
      yield* events.subscribe("all", { type: "all-threads" });
      yield* events.subscribe("vault", { type: "vault", vaultId: vault.id });
      yield* events.subscribe("list", { type: "vault-threads", vaultId: vault.id });
      yield* events.subscribe("thread", { type: "thread", threadId: thread.id, after: 0 });
      yield* Deferred.succeed(closing, undefined);
      // The body ends instead of running forever.
      yield* events.ended;
      expect(events.status).toBe(200);
    }),
  );
});
