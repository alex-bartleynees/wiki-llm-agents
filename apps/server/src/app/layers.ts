import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { VaultRepositoryLive } from "../features/vaults/sqlite-repository.js";
import { AppConfig } from "../shared/config.js";
import { OriginGuardLive } from "../shared/origin-guard.js";
import { SqliteLive } from "../shared/persistence/sqlite.js";
import { router } from "./router.js";

/** Repositories for every feature, over one shared SQLite connection. */
export const RepositoriesLive = Layer.mergeAll(VaultRepositoryLive);

/** The HTTP app without a listening server or database, so tests can supply both. */
export const HttpAppLive = HttpRouter.serve(Layer.mergeAll(router, OriginGuardLive), {
  disableLogger: true,
}).pipe(Layer.provide(RepositoriesLive));

const ServerLive = NodeHttpServer.layerConfig(() => createServer(), {
  host: AppConfig.host,
  port: AppConfig.port,
});

export const AppLive = HttpAppLive.pipe(Layer.provide(SqliteLive), Layer.provide(ServerLive));
