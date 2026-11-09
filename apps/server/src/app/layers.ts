import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { VaultRepositoryLive } from "../features/vaults/sqlite-repository.js";
import { startupVaults } from "../features/vaults/startup-vaults.js";
import { AppConfig } from "../shared/config.js";
import { OriginGuardLive } from "../shared/origin-guard.js";
import { SqliteLive } from "../shared/persistence/sqlite.js";
import { router } from "./router.js";

/** Repositories for every feature, over one shared SQLite connection. */
export const RepositoriesLive = Layer.mergeAll(VaultRepositoryLive);

export interface AppOptions {
  /** Folders from `--vault`, registered before the server starts. */
  readonly vaults: ReadonlyArray<string>;
}

/** The HTTP app without a listening server or database, so tests can supply both. */
export const makeHttpApp = (options: AppOptions) =>
  HttpRouter.serve(Layer.mergeAll(router, OriginGuardLive), { disableLogger: true }).pipe(
    Layer.provide(startupVaults(options.vaults)),
    Layer.provide(RepositoriesLive),
  );

const ServerLive = NodeHttpServer.layerConfig(() => createServer(), {
  host: AppConfig.host,
  port: AppConfig.port,
});

export const makeAppLive = (options: AppOptions) =>
  makeHttpApp(options).pipe(Layer.provide(SqliteLive), Layer.provide(ServerLive));
