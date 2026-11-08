import { HttpRouter } from "effect/http";
import { listVaultsEndpoint } from "./list-vaults/endpoint.js";

export const vaultsRouter = HttpRouter.add("GET", "/api/vaults", listVaultsEndpoint);
