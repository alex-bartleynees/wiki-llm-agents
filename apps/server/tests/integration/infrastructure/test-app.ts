import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { makeAgentCatalog } from "../../../src/features/agents/catalog-live.js";
import { type AppOptions, makeHttpApp } from "../../../src/app/layers.js";
import { makeAttachmentStore } from "../../../src/features/attachments/store-live.js";
import { makeWorktreeRoot } from "../../../src/features/projects/worktrees.js";
import { makeProviderRegistry } from "../../../src/features/providers/registry-live.js";
import type { DeclaredSecrets } from "../../../src/features/secrets/declared.js";
import { makeSecretStore } from "../../../src/features/secrets/store-live.js";
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

/** Thread worktrees in a fresh temp folder (canonical), removed when the test layer closes. */
export const TestWorktrees = Layer.unwrap(
  Effect.map(
    Effect.acquireRelease(
      Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), "wiki-agents-worktrees-")))),
      (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
    ),
    (dir) => makeWorktreeRoot(dir),
  ),
);

/**
 * Secrets in a fresh temp folder with a key file beside it (never systemd, never your
 * real key), removed when the test layer closes. `root` is where a test finds
 * `data/secrets.enc` and `state/secrets.key`.
 */
export const makeTestSecrets = (options: { readonly declared?: DeclaredSecrets; readonly onRoot?: (root: string) => void } = {}) =>
  Layer.unwrap(
    Effect.map(
      Effect.acquireRelease(
        Effect.sync(() => mkdtempSync(join(tmpdir(), "wiki-agents-secrets-"))),
        (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
      ),
      (root) => {
        options.onRoot?.(root);
        return makeSecretStore({ dir: join(root, "data"), keyFile: join(root, "state", "secrets.key"), keySource: "file", declared: options.declared ?? { files: new Map(), problems: [] } });
      },
    ),
  );

export const TestSecrets = makeTestSecrets();

/** The replay provider alone, so tests never start OpenCode. */
export const ReplayOnly = makeProviderRegistry(Effect.succeed([ReplayAdapter]));

/**
 * The real HTTP app on an ephemeral port, with an HttpClient pointed at it.
 * Sqlite is exposed so tests can seed data the API can't create yet.
 */
export const makeTestApp = (options: Partial<AppOptions> = {}) =>
  makeHttpApp({ vaults: [], watch: false, providers: ReplayOnly, agents: TestAgents, attachments: TestAttachments, worktrees: TestWorktrees, secrets: TestSecrets, ...options }).pipe(Layer.provideMerge(TestSqlite), Layer.provideMerge(NodeHttpServer.layerTest));

export const TestApp = makeTestApp();
