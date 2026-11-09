import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { listVaultsEndpoint } from "./list-vaults/endpoint.js";
import { registerVaultEndpoint } from "./register-vault/endpoint.js";

export const vaultsRouter = Layer.mergeAll(
  HttpRouter.add("GET", "/api/vaults", listVaultsEndpoint),
  HttpRouter.add("POST", "/api/vaults", registerVaultEndpoint),
);
