import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { IndexerLive } from "../features/indexing/indexer-live.js";
import { IndexStoreLive } from "../features/indexing/sqlite-store.js";
import { IndexingStartup } from "../features/indexing/startup.js";
import { VaultWatcherLive, VaultWatcherNoop } from "../features/indexing/watcher.js";
import { PinRepositoryLive } from "../features/pins/sqlite-repository.js";
import type { ProviderRegistry } from "../features/providers/registry.js";
import { ProviderRegistryLive } from "../features/providers/registry-live.js";
import { ThreadRepositoryLive } from "../features/threads/sqlite-repository.js";
import { ThreadsStartup } from "../features/threads/startup.js";
import { ThreadActorsLive } from "../features/threads/thread-actors.js";
import { ThreadBusLive } from "../features/threads/thread-bus.js";
import { VaultRepositoryLive } from "../features/vaults/sqlite-repository.js";
import { startupVaults } from "../features/vaults/startup-vaults.js";
import { AppConfig } from "../shared/config.js";
import { OriginGuardLive } from "../shared/origin-guard.js";
import type { DbError } from "../shared/persistence/errors.js";
import { type Sqlite, SqliteLive } from "../shared/persistence/sqlite.js";
import { router } from "./router.js";

/** Repositories for every feature, over one shared SQLite connection. */
export const RepositoriesLive = Layer.mergeAll(VaultRepositoryLive, PinRepositoryLive, ThreadRepositoryLive);

export interface AppOptions {
  /** Folders from `--vault`, registered before the server starts. */
  readonly vaults: ReadonlyArray<string>;
  /** Watch vault folders for changes. Off in tests that drive the indexer themselves. */
  readonly watch: boolean;
  /** The providers threads can use; OpenCode and replay unless a test chooses. */
  readonly providers?: Layer.Layer<ProviderRegistry, DbError, Sqlite>;
}

/** The vault index, the IndexerActor, and the file watcher. */
const indexing = (watch: boolean) =>
  (watch ? VaultWatcherLive : VaultWatcherNoop).pipe(
    Layer.provideMerge(IndexerLive),
    Layer.provideMerge(IndexStoreLive),
  );

/** ThreadActors and the bus their events go out on. */
const threads = ThreadActorsLive.pipe(Layer.provideMerge(ThreadBusLive));

/**
 * The HTTP app without a listening server or database, so tests can supply both.
 * Its services (repositories, indexer...) are part of the output, for tests.
 */
export const makeHttpApp = (options: AppOptions) =>
  HttpRouter.serve(Layer.mergeAll(router, OriginGuardLive), { disableLogger: true }).pipe(
    Layer.provide(Layer.mergeAll(startupVaults(options.vaults), IndexingStartup, ThreadsStartup)),
    Layer.provideMerge(threads),
    Layer.provideMerge(Layer.mergeAll(RepositoriesLive, options.providers ?? ProviderRegistryLive, indexing(options.watch))),
  );

const ServerLive = NodeHttpServer.layerConfig(() => createServer(), {
  host: AppConfig.host,
  port: AppConfig.port,
});

export const makeAppLive = (options: Omit<AppOptions, "watch">) =>
  makeHttpApp({ ...options, watch: true }).pipe(Layer.provide(SqliteLive), Layer.provide(ServerLive));
