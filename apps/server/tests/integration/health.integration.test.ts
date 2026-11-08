import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import { HttpClient } from "effect/http";
import { TestApp } from "./infrastructure/test-app.js";

layer(TestApp)("health", (it) => {
  it.effect("reports healthy through the real HTTP server", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.get("/health");
      expect(response.status).toBe(200);
      expect(yield* response.text).toBe("ok");
    }),
  );
});
