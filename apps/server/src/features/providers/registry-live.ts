import type { ProviderInstance } from "@wiki-agents/contracts/providers/model";
import { asc, eq } from "drizzle-orm";
import { Clock, Effect, Layer, type Scope } from "effect";
import { AppConfig } from "../../shared/config.js";
import { DbError } from "../../shared/persistence/errors.js";
import { Sqlite } from "../../shared/persistence/sqlite.js";
import { makeClaudeCodeAdapter } from "./claude-code/adapter.js";
import { authStatus, binaryVersion as claudeVersion } from "./claude-code/cli.js";
import { makeClaudeCodeSdk } from "./claude-code/sdk.js";
import { makeCodexLauncher } from "./codex/app-server.js";
import { makeCodexAdapter } from "./codex/adapter.js";
import { authStatus as codexAuthStatus, binaryVersion as codexVersion } from "./codex/cli.js";
import { makeProviderEnvironment } from "../../shared/provider-environment.js";
import { SecretMaterial } from "../secrets/material.js";
import { makeOpenCodeAdapter } from "./opencode/adapter.js";
import { binaryVersion, startServer } from "./opencode/server.js";
import type { ProviderAdapter } from "./port.js";
import { ProviderInstanceNotFound, ProviderRegistry } from "./registry.js";
import { ReplayAdapter } from "./replay/adapter.js";
import { providerInstances } from "./table.js";

/** The replay provider's instance, in tests only (see `ProviderRegistryLive`). */
export const REPLAY_INSTANCE_ID = "replay";
export const OPENCODE_INSTANCE_ID = "opencode";
export const CLAUDE_CODE_INSTANCE_ID = "claude-code";
export const CODEX_INSTANCE_ID = "codex";

/** Instance names, for the instance each adapter gets at startup (its id is the kind). */
const NAMES: Readonly<Record<string, string>> = {
  replay: "Replay (recorded, free)",
  opencode: "OpenCode",
  "claude-code": "Claude Code",
  codex: "Codex",
};

/**
 * Instances in `provider_instances`, run by the adapters given here. Each adapter
 * gets an instance at startup with its kind as the id. Instances are listed in the
 * adapters' order; the first is the default for new threads.
 */
export const makeProviderRegistry = <E, R>(makeAdapters: Effect.Effect<ReadonlyArray<ProviderAdapter>, E, R>) =>
  Layer.effect(
    ProviderRegistry,
    Effect.gen(function* () {
      const adapters = yield* makeAdapters;
      const { db } = yield* Sqlite;
      const query = <A>(run: () => A) => Effect.try({ try: run, catch: (cause) => new DbError({ cause }) });
      const byKind = new Map(adapters.map((adapter) => [adapter.kind, adapter]));
      const order = (kind: string) => adapters.findIndex((adapter) => adapter.kind === kind);

      const now = yield* Clock.currentTimeMillis;
      for (const adapter of adapters) {
        yield* query(() =>
          db
            .insert(providerInstances)
            .values({ id: adapter.kind, kind: adapter.kind, name: NAMES[adapter.kind] ?? adapter.kind, createdAt: new Date(now) })
            .onConflictDoNothing()
            .run(),
        );
      }

      const toInstance = (row: typeof providerInstances.$inferSelect, adapter: ProviderAdapter): ProviderInstance => ({
        id: row.id,
        kind: row.kind,
        name: row.name,
        capabilities: adapter.capabilities,
        ...(adapter.complete === undefined ? {} : { toolFreeCompletion: true }),
      });

      const list = query(() => db.select().from(providerInstances).orderBy(asc(providerInstances.createdAt)).all()).pipe(
        Effect.map((rows) =>
          rows
            .flatMap((row) => {
              const adapter = byKind.get(row.kind);
              return adapter === undefined ? [] : [toInstance(row, adapter)];
            })
            .sort((a, b) => order(a.kind) - order(b.kind)),
        ),
      );

      const get = Effect.fnUntraced(function* (providerInstanceId: string) {
        const row = yield* query(() => db.select().from(providerInstances).where(eq(providerInstances.id, providerInstanceId)).get());
        const adapter = row === undefined ? undefined : byKind.get(row.kind);
        if (row === undefined || adapter === undefined) return yield* new ProviderInstanceNotFound({ providerInstanceId });
        return { instance: toInstance(row, adapter), adapter };
      });

      const defaultInstance = Effect.flatMap(list, (instances) =>
        instances[0] === undefined
          ? Effect.fail(new ProviderInstanceNotFound({ providerInstanceId: "(default)" }))
          : Effect.succeed(instances[0]),
      );

      return ProviderRegistry.of({ list, defaultInstance, get });
    }),
  );

/**
 * The environment providers start with, worked out as each process starts: without
 * the variables MCP servers take secrets from (as last read; every turn reads them).
 */
const ProviderEnvironment = Effect.gen(function* () {
  const material = yield* SecretMaterial;
  return yield* makeProviderEnvironment(() => material.latest().envNames);
});

/** OpenCode, run from the `opencode` on PATH (or `WIKI_AGENTS_OPENCODE`), with its todo tool if `WIKI_AGENTS_OPENCODE_TODO`. */
export const OpenCodeAdapterLive: Effect.Effect<ProviderAdapter, never, Scope.Scope | SecretMaterial> = Effect.gen(function* () {
  const binary = yield* AppConfig.opencodeBinary.pipe(Effect.orDie);
  const todo = yield* AppConfig.opencodeTodo.pipe(Effect.orDie);
  const environment = yield* ProviderEnvironment;
  // OpenCode stops when idle, so each start takes the environment as it is then.
  const start = Effect.suspend(() => startServer({ binary, todo, env: environment() }));
  return yield* makeOpenCodeAdapter({ start, installedVersion: binaryVersion(binary) });
});

/** Claude Code, run from the `claude` on PATH (or `WIKI_AGENTS_CLAUDE`), with your login. */
export const ClaudeCodeAdapterLive: Effect.Effect<ProviderAdapter, never, SecretMaterial> = Effect.gen(function* () {
  const binary = yield* AppConfig.claudeBinary.pipe(Effect.orDie);
  return yield* makeClaudeCodeAdapter({ sdk: makeClaudeCodeSdk(yield* ProviderEnvironment), binary, installedVersion: claudeVersion, authStatus });
});

/** Codex, run from the `codex` on PATH (or `WIKI_AGENTS_CODEX`), with your login. */
export const CodexAdapterLive: Effect.Effect<ProviderAdapter, never, SecretMaterial> = Effect.gen(function* () {
  const binary = yield* AppConfig.codexBinary.pipe(Effect.orDie);
  const launcher = makeCodexLauncher(yield* ProviderEnvironment);
  return yield* makeCodexAdapter({
    launcher,
    binary,
    installedVersion: codexVersion,
    authStatus: (path) => codexAuthStatus(launcher, path),
  });
});

/**
 * OpenCode first (the default for new threads), then Claude Code and Codex. The
 * replay provider is for tests only: it is added with `WIKI_AGENTS_TEST_HOOKS=true`,
 * so end-to-end flows can run turns without an agent installed.
 */
export const ProviderRegistryLive = makeProviderRegistry(
  Effect.gen(function* () {
    const adapters: ReadonlyArray<ProviderAdapter> = [yield* OpenCodeAdapterLive, yield* ClaudeCodeAdapterLive, yield* CodexAdapterLive];
    const testHooks = yield* AppConfig.testHooks.pipe(Effect.orDie);
    return testHooks ? [...adapters, ReplayAdapter] : adapters;
  }),
);
