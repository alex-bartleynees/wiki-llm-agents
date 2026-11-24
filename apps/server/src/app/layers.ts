import { join } from "node:path";
import { makeSkills, SkillsLive } from "../features/skills/skills-live.js";
import type { Skills } from "../features/skills/skills.js";
import type { SecretMaterial } from "../features/secrets/material.js";
import { ProjectRepositoryLive } from "../features/projects/sqlite-repository.js";
import { NodeChildProcessSpawner, NodeFileSystem, NodeHttpServer, NodePath } from "@effect/platform-node";
import { type Config, Effect, type FileSystem, Layer, Option } from "effect";
import { HttpRouter } from "effect/http";
import type { ChildProcessSpawner } from "effect/process";
import type { AgentCatalog } from "../features/agents/catalog.js";
import type { AttachmentStore } from "../features/attachments/attachment-store.js";
import { AttachmentStoreLive } from "../features/attachments/store-live.js";
import { type WorktreeRoot, WorktreeRootLive } from "../features/projects/worktrees.js";
import { AgentCatalogLive } from "../features/agents/catalog-live.js";
import { ChangeTrackerLive } from "../features/changes/change-tracker.js";
import { EventConnectionsLive } from "../features/events/connections.js";
import { ChangeLogLive } from "../features/changes/sqlite-repository.js";
import { DeliveryChannels, inAppChannel } from "../features/inbox/delivery.js";
import { InboxLive } from "../features/inbox/inbox.js";
import { InboxBus, InboxBusLive } from "../features/inbox/inbox-bus.js";
import { NoteWriteLockLive } from "../features/notes/write-lock.js";
import { type DigestSignal, DigestSignalLive } from "../features/notifications/digest.js";
import { type PushSender, PushSenderLive } from "../features/notifications/push-sender.js";
import type { NotificationsRepository } from "../features/notifications/repository.js";
import { NotificationsRepositoryLive } from "../features/notifications/sqlite-repository.js";
import { NotificationsStartup } from "../features/notifications/startup.js";
import { makeWebPushChannel } from "../features/notifications/web-push-channel.js";
import { InboxRepositoryLive } from "../features/inbox/sqlite-repository.js";
import { InboxStartup } from "../features/inbox/startup.js";
import { IndexerLive } from "../features/indexing/indexer-live.js";
import { IndexStoreLive } from "../features/indexing/sqlite-store.js";
import { IndexingStartup } from "../features/indexing/startup.js";
import { makeVaultWatcher, VaultWatcherNoop } from "../features/indexing/watcher.js";
import { McpConnectionsLive } from "../features/mcp-oauth/connections-live.js";
import { appOrigins, type BrowserSettings } from "../features/mcp-servers/browser.js";
import { makeMcpServerCatalog } from "../features/mcp-servers/catalog-live.js";
import { McpPoolLive } from "../features/mcp-servers/pool-live.js";
import { McpGatewayLive } from "../features/mcp-gateway/gateway-live.js";
import { McpTokensLive } from "../features/mcp/tokens.js";
import { ThreadMcpRegistrationLive } from "../features/mcp/thread-mcp-registration-live.js";
import { PinRepositoryLive } from "../features/pins/sqlite-repository.js";
import type { ProviderRegistry } from "../features/providers/registry.js";
import { ProviderRegistryLive } from "../features/providers/registry-live.js";
import { SchedulerSignalLive } from "../features/schedules/signal.js";
import type { SecretStore } from "../features/secrets/secret-store.js";
import { SecretMaterialLive } from "../features/secrets/material-live.js";
import { SecretStoreLive } from "../features/secrets/store-live.js";
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
import { WallClock, WallClockLive } from "../shared/wall-clock.js";
import { router } from "./router.js";

/** Repositories for every feature, over one shared SQLite connection. */
export const RepositoriesLive = Layer.mergeAll(
  ProjectRepositoryLive,
  VaultRepositoryLive,
  PinRepositoryLive,
  ThreadRepositoryLive,
  InboxRepositoryLive,
  ScheduleRepositoryLive,
  NotificationsRepositoryLive,
);

export interface AppOptions {
  readonly skills?: Layer.Layer<Skills, Config.ConfigError, SecretMaterial | FileSystem.FileSystem>;
  /** Folders from `--vault`, registered before the server starts. */
  readonly vaults: ReadonlyArray<string>;
  /** Watch vault folders for changes. Off in tests that drive the indexer themselves. */
  readonly watch: boolean;
  /** Poll vault files at this interval instead of using file system events. */
  readonly watchPollMs?: number | undefined;
  /** The providers threads can use; OpenCode, Claude Code and Codex unless a test chooses. */
  readonly providers?: Layer.Layer<ProviderRegistry, DbError, Sqlite>;
  /** The rules and agents. Required, so a test can never fall back to your real config directory. */
  readonly agents: Layer.Layer<AgentCatalog, never, FileSystem.FileSystem>;
  /** Where message attachments are kept. Required, so a test can never write to your real data directory. */
  readonly attachments: Layer.Layer<AttachmentStore, never, Sqlite | FileSystem.FileSystem>;
  /** Secrets for MCP servers. Required, so a test can never read or write your real secrets or their key. */
  readonly secrets: Layer.Layer<SecretStore, never, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner>;
  /** Where thread worktrees are made. Required, so a test can never make one in your real data directory. */
  readonly worktrees: Layer.Layer<WorktreeRoot>;
  /** How inbox items reach you: in-app and Web Push unless a test chooses (a channel that fails, say). */
  readonly channels?: Layer.Layer<DeliveryChannels, never, InboxBus | DigestSignal | NotificationsRepository | WallClock | PushSender>;
  /** Sends Web Push notifications; the real push services unless a test stands in for them. */
  readonly pushSender?: Layer.Layer<PushSender, unknown, NotificationsRepository>;
  /** How to run the built-in browser MCP server; none unless given (`WIKI_AGENTS_BROWSER_MCP` in the app). */
  readonly browser?: BrowserSettings | null;
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
 * providers (tokens for `/mcp` at this server's address, and the gateway's tools from
 * other MCP servers).
 */
const threads = ThreadActorsLive.pipe(
  Layer.provideMerge(Layer.merge(ThreadBusLive, ThreadMcpRegistrationLive)),
  Layer.provideMerge(Layer.merge(McpTokensLive, McpGatewayLive)),
);

/** Inbox items go to the open browsers and, as notifications, to your devices. */
const DeliveryChannelsLive = Layer.effect(
  DeliveryChannels,
  Effect.gen(function* () {
    return [inAppChannel(yield* InboxBus), yield* makeWebPushChannel];
  }),
);

/** Running programs (git, for the Diff view's commit and push) through Effect's spawner on this machine. */
const ProcessesLive = NodeChildProcessSpawner.layer.pipe(Layer.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)));

/** The inbox, its live bus and delivery channels, and the scheduler's and digest's wake-up signals. */
const inboxAndSchedules = (channels: AppOptions["channels"]) =>
  Layer.mergeAll(
    InboxLive.pipe(Layer.provideMerge(channels ?? DeliveryChannelsLive), Layer.provideMerge(Layer.merge(InboxBusLive, DigestSignalLive))),
    SchedulerSignalLive,
  );

/**
 * The HTTP app without a listening server or database, so tests can supply both.
 * Its services (repositories, indexer...) are part of the output, for tests.
 */
export const makeHttpApp = (options: AppOptions) =>
  HttpRouter.serve(Layer.mergeAll(router, OriginGuardLive), { disableLogger: true }).pipe(
    Layer.provide(Layer.mergeAll(startupVaults(options.vaults), IndexingStartup, ThreadsStartup, InboxStartup, SchedulesStartup, NotificationsStartup)),
    Layer.provideMerge(inboxAndSchedules(options.channels)),
    Layer.provideMerge(threads),
    Layer.provideMerge(options.pushSender ?? PushSenderLive),
    Layer.provideMerge(McpPoolLive),
    Layer.provideMerge(McpConnectionsLive),
    // Providers and the pool withhold what SecretMaterial lists, which reads the server list.
    Layer.provideMerge(options.providers ?? ProviderRegistryLive),
    Layer.provideMerge(options.skills ?? makeSkills(null)),
    Layer.provideMerge(SecretMaterialLive),
    Layer.provideMerge(makeMcpServerCatalog(options.browser ?? null)),
    Layer.provideMerge(Layer.mergeAll(
        RepositoriesLive,
        NoteWriteLockLive,
        options.agents,
        options.attachments,
        options.worktrees,
        options.secrets.pipe(Layer.provide(ProcessesLive)),
        indexing(options.watch, options.watchPollMs),
        WallClockLive,
        EventConnectionsLive,
        ProcessesLive,
      )),
  );

/** The Node server, and the signal its SSE streams end on when it starts closing. */
const ServerLive = Layer.unwrap(
  Effect.sync(() => {
    const { server, closing } = makeClosingServer();
    return Layer.merge(NodeHttpServer.layerConfig(() => server, { host: AppConfig.host, port: AppConfig.port }), closing);
  }),
);

/** The built-in browser's settings from `WIKI_AGENTS_BROWSER_MCP`, or null when it isn't set. */
const browserSettings = Effect.gen(function* () {
  const command = yield* AppConfig.browserMcp;
  if (Option.isNone(command) || command.value.trim() === "") return null;
  const settings: BrowserSettings = {
    command: command.value.trim(),
    stateDir: join(yield* AppConfig.dataDir, "browser"),
    blockedOrigins: appOrigins(yield* AppConfig.host, yield* AppConfig.port),
  };
  return settings;
});

export const makeAppLive = (options: Omit<AppOptions, "watch" | "watchPollMs" | "agents" | "attachments" | "worktrees" | "secrets" | "browser">) =>
  Layer.unwrap(
    Effect.map(Effect.all([AppConfig.watchPollMs, browserSettings]), ([pollMs, browser]) =>
      makeHttpApp({
        ...options,
        watch: true,
        watchPollMs: Option.getOrUndefined(pollMs),
        browser,
        agents: AgentCatalogLive,
        skills: SkillsLive,
        attachments: AttachmentStoreLive,
        worktrees: WorktreeRootLive,
        secrets: SecretStoreLive,
      }),
    ),
  ).pipe(Layer.provide(SqliteLive), Layer.provide(ServerLive));
