import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { rebuildIndexEndpoint } from "./rebuild-index/endpoint.js";
import { streamVaultEventsEndpoint } from "./stream-vault-events/endpoint.js";

export const indexingRouter = Layer.mergeAll(
  HttpRouter.add("POST", "/api/vaults/:vaultId/rebuild-index", rebuildIndexEndpoint),
  HttpRouter.add("GET", "/events/vaults/:vaultId", streamVaultEventsEndpoint),
);
