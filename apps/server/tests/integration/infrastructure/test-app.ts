import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { makeAgentCatalog } from "../../../src/features/agents/catalog-live.js";
import { type AppOptions, makeHttpApp } from "../../../src/app/layers.js";
import { makeAttachmentStore } from "../../../src/features/attachments/store-live.js";
import { makeProviderRegistry } from "../../../src/features/providers/registry-live.js";
import { ReplayAdapter } from "../../../src/features/providers/replay/adapter.js";
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
 * The rules and agents in a fresh temp config directory (seeded with the defaults),
 * not watched: tests write files and call `reload`.
 */
export const TestAgents = Layer.unwrap(
  Effect.map(
    Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "wiki-agents-config-"))),
      (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
    ),
    (dir) => makeAgentCatalog({ dir, watch: false }),
  ),
);

/** Attachments in a fresh temp folder, removed when the test layer closes. */
export const TestAttachments = Layer.unwrap(
  Effect.map(
    Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "wiki-agents-attachments-"))),
      (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
    ),
    (dir) => makeAttachmentStore(dir),
  ),
);

/** The replay provider alone, so tests never start OpenCode. */
export const ReplayOnly = makeProviderRegistry(Effect.succeed([ReplayAdapter]));

/**
 * The real HTTP app on an ephemeral port, with an HttpClient pointed at it.
 * Sqlite is exposed so tests can seed data the API can't create yet.
 */
export const makeTestApp = (options: Partial<AppOptions> = {}) =>
  makeHttpApp({ vaults: [], watch: false, providers: ReplayOnly, agents: TestAgents, attachments: TestAttachments, ...options }).pipe(Layer.provideMerge(TestSqlite), Layer.provideMerge(NodeHttpServer.layerTest));

export const TestApp = makeTestApp();
