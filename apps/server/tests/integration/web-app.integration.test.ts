import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, layer } from "@effect/vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { IMMUTABLE_CACHE, REVALIDATE_CACHE } from "../../src/app/web-app.js";
import { TestApp } from "./infrastructure/test-app.js";

const SHELL = "<!doctype html><title>app shell</title>";
const ASSET = "console.log('app')";

/** A fake SvelteKit build in a temp directory, removed when the layer closes. */
const FakeWebBuild = Layer.unwrap(
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "wiki-agents-web-"))),
      (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
    );
    mkdirSync(join(root, "_app", "immutable"), { recursive: true });
    writeFileSync(join(root, "index.html"), SHELL);
    writeFileSync(join(root, "_app", "immutable", "app.abc123.js"), ASSET);
    return ConfigProvider.layer(ConfigProvider.fromUnknown({ WIKI_AGENTS_STATIC_DIR: root }));
  }),
);

const get = (path: string, accept = "text/html") =>
  HttpClient.execute(HttpClientRequest.get(path).pipe(HttpClientRequest.setHeader("accept", accept)));

layer(TestApp.pipe(Layer.provide(FakeWebBuild)))("serving the web app", (it) => {
  it.effect("serves index.html at / and revalidates it", () =>
    Effect.gen(function* () {
      const response = yield* get("/");
      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe(REVALIDATE_CACHE);
      expect(yield* response.text).toBe(SHELL);
    }),
  );

  it.effect("serves the app shell for deep links from a browser", () =>
    Effect.gen(function* () {
      const response = yield* get("/notes/some/deep/link");
      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe(REVALIDATE_CACHE);
      expect(yield* response.text).toBe(SHELL);
    }),
  );

  it.effect("caches hashed build assets for a year", () =>
    Effect.gen(function* () {
      const response = yield* get("/_app/immutable/app.abc123.js", "*/*");
      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe(IMMUTABLE_CACHE);
      expect(yield* response.text).toBe(ASSET);
    }),
  );

  it.effect("returns 404 for a missing build asset", () =>
    Effect.gen(function* () {
      expect((yield* get("/_app/immutable/missing.js", "*/*")).status).toBe(404);
    }),
  );

  it.effect.each(["/api/nope", "/mcp/nope", "/events/nope"])(
    "returns 404, not the app shell, for unknown server path %s",
    (path) =>
      Effect.gen(function* () {
        const response = yield* get(path);
        expect(response.status).toBe(404);
        expect(yield* response.text).not.toBe(SHELL);
      }),
  );

  it.effect("still routes real API endpoints", () =>
    Effect.gen(function* () {
      const response = yield* get("/api/vaults", "application/json");
      expect(response.status).toBe(200);
      expect(yield* response.json).toEqual({ vaults: [] });
    }),
  );
});
