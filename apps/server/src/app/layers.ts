import { ProjectRepositoryLive } from "../features/projects/sqlite-repository.js";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, type FileSystem, Layer, Option } from "effect";
import { HttpRouter } from "effect/http";
import type { AgentCatalog } from "../features/agents/catalog.js";
import { AgentCatalogLive } from "../features/agents/catalog-live.js";
import { ChangeTrackerLive } from "../features/changes/change-tracker.js";
import { ChangeLogLive } from "../features/changes/sqlite-repository.js";
import { type DeliveryChannels, DeliveryChannelsLive } from "../features/inbox/delivery.js";
import { InboxLive } from "../features/inbox/inbox.js";
import { type InboxBus, InboxBusLive } from "../features/inbox/inbox-bus.js";
import { InboxRepositoryLive } from "../features/inbox/sqlite-repository.js";
import { InboxStartup } from "../features/inbox/startup.js";
import { IndexerLive } from "../features/indexing/indexer-live.js";
import { IndexStoreLive } from "../features/indexing/sqlite-store.js";
import { IndexingStartup } from "../features/indexing/startup.js";
import { makeVaultWatcher, VaultWatcherNoop } from "../features/indexing/watcher.js";
import { McpTokensLive } from "../features/mcp/tokens.js";
import { VaultToolsLive } from "../features/mcp/vault-tools-live.js";
import { PinRepositoryLive } from "../features/pins/sqlite-repository.js";
import type { ProviderRegistry } from "../features/providers/registry.js";
import { ProviderRegistryLive } from "../features/providers/registry-live.js";
import { SchedulerSignalLive } from "../features/schedules/signal.js";
import { ScheduleRepositoryLive } from "../features/schedules/sqlite-repository.js";
import { SchedulesStartup } from "../features/schedules/startup.js";
import { ThreadRepositoryLive } from "../features/threads/sqlite-repository.js";
import { ThreadsStartup } from "../features/threads/startup.js";
import { ThreadActorsLive } from "../features/threads/thread-actors.js";
import { ThreadBusLive } from "../features/threads/thread-bus.js";
import { VaultRepositoryLive } from "../features/vaults/sqlite-repository.js";
import { startupVaults } from "../features/vaults/startup-vaults.js";
import { AppConfig } from "../shared/config.js";
import { OriginGuardLive } from "../shared/origin-guard.js";
import { makeClosingServer } from "../shared/server-closing.js";
import type { DbError } from "../shared/persistence/errors.js";
import { type Sqlite, SqliteLive } from "../shared/persistence/sqlite.js";
import { WallClockLive } from "../shared/wall-clock.js";
import { router } from "./router.js";

/** Repositories for every feature, over one shared SQLite connection. */
export const RepositoriesLive = Layer.mergeAll(
  ProjectRepositoryLive,
  VaultRepositoryLive,
  PinRepositoryLive,
  ThreadRepositoryLive,
  InboxRepositoryLive,
  ScheduleRepositoryLive,
);

export interface AppOptions {
  /** Folders from `--vault`, registered before the server starts. */
  readonly vaults: ReadonlyArray<string>;
  /** Watch vault folders for changes. Off in tests that drive the indexer themselves. */
  readonly watch: boolean;
  /** Poll vault files at this interval instead of using file system events. */
  readonly watchPollMs?: number | undefined;
  /** The providers threads can use; OpenCode and replay unless a test chooses. */
  readonly providers?: Layer.Layer<ProviderRegistry, DbError, Sqlite>;
  /** The rules and agents. Required, so a test can never fall back to your real config directory. */
  readonly agents: Layer.Layer<AgentCatalog, never, FileSystem.FileSystem>;
  /** How inbox items reach you; in-app only unless a test adds a channel (one that fails, say). */
  readonly channels?: Layer.Layer<DeliveryChannels, never, InboxBus>;
}

/**
 * The vault index, the IndexerActor, the file watcher, and change review's tracker,
 * which the indexer tells about every note change.
 */
const indexing = (watch: boolean, pollMs: number | undefined) =>
  (watch ? makeVaultWatcher({ pollMs }) : VaultWatcherNoop).pipe(
    Layer.provideMerge(IndexerLive),
    Layer.provideMerge(ChangeTrackerLive),
    Layer.provideMerge(Layer.merge(IndexStoreLive, ChangeLogLive)),
  );

/**
 * ThreadActors, the bus their events go out on, and the vault tools they give their
 * providers (tokens for `/mcp` at this server's address).
 */
const threads = ThreadActorsLive.pipe(
  Layer.provideMerge(Layer.merge(ThreadBusLive, VaultToolsLive)),
  Layer.provideMerge(McpTokensLive),
);

/** The inbox, its live bus and delivery channels, and the scheduler's wake-up signal. */
const inboxAndSchedules = (channels: AppOptions["channels"]) =>
  Layer.merge(InboxLive.pipe(Layer.provideMerge(channels ?? DeliveryChannelsLive), Layer.provideMerge(InboxBusLive)), SchedulerSignalLive);

/**
 * The HTTP app without a listening server or database, so tests can supply both.
 * Its services (repositories, indexer...) are part of the output, for tests.
 */
export const makeHttpApp = (options: AppOptions) =>
  HttpRouter.serve(Layer.mergeAll(router, OriginGuardLive), { disableLogger: true }).pipe(
    Layer.provide(Layer.mergeAll(startupVaults(options.vaults), IndexingStartup, ThreadsStartup, InboxStartup, SchedulesStartup)),
    Layer.provideMerge(inboxAndSchedules(options.channels)),
    Layer.provideMerge(threads),
    Layer.provideMerge(Layer.mergeAll(
        RepositoriesLive,
        options.providers ?? ProviderRegistryLive,
        options.agents,
        indexing(options.watch, options.watchPollMs),
        WallClockLive,
      )),
  );

/** The Node server, and the signal its SSE streams end on when it starts closing. */
const ServerLive = Layer.unwrap(
  Effect.sync(() => {
    const { server, closing } = makeClosingServer();
    return Layer.merge(NodeHttpServer.layerConfig(() => server, { host: AppConfig.host, port: AppConfig.port }), closing);
  }),
);

export const makeAppLive = (options: Omit<AppOptions, "watch" | "watchPollMs" | "agents">) =>
  Layer.unwrap(
    Effect.map(AppConfig.watchPollMs, (pollMs) =>
      makeHttpApp({ ...options, watch: true, watchPollMs: Option.getOrUndefined(pollMs), agents: AgentCatalogLive }),
    ),
  ).pipe(Layer.provide(SqliteLive), Layer.provide(ServerLive));
