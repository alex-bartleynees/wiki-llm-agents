import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { type AppOptions, makeHttpApp } from "../../../src/app/layers.js";
import { makeSqlite, Sqlite } from "../../../src/shared/persistence/sqlite.js";

const migrationsDir = fileURLToPath(new URL("../../../drizzle", import.meta.url));

/** A real SQLite file in a fresh temp directory, removed when the test layer closes. */
export const TestSqlite = Layer.effect(
  Sqlite,
  Effect.gen(function* () {
    const dir = yield* Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "wiki-agents-test-"))),
      (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
    );
    return yield* makeSqlite({ file: join(dir, "app.db"), migrationsDir });
  }),
);

/**
 * The real HTTP app on an ephemeral port, with an HttpClient pointed at it.
 * Sqlite is exposed so tests can seed data the API can't create yet.
 */
export const makeTestApp = (options: AppOptions) =>
  makeHttpApp(options).pipe(Layer.provideMerge(TestSqlite), Layer.provideMerge(NodeHttpServer.layerTest));

export const TestApp = makeTestApp({ vaults: [] });
