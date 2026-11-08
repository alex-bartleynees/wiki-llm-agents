import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { TestApp } from "./infrastructure/test-app.js";

layer(TestApp)("origin guard", (it) => {
  it.effect("rejects a cross-site write before routing", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.execute(
        HttpClientRequest.post("/api/vaults").pipe(
          HttpClientRequest.setHeader("origin", "https://evil.example"),
        ),
      );
      expect(response.status).toBe(403);
    }),
  );

  it.effect("allows cross-site reads", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.execute(
        HttpClientRequest.get("/api/vaults").pipe(
          HttpClientRequest.setHeader("origin", "https://evil.example"),
        ),
      );
      expect(response.status).toBe(200);
    }),
  );
});
