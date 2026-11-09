import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { listTagsEndpoint } from "./list-tags/endpoint.js";
import { quickSwitchEndpoint } from "./quick-switch/endpoint.js";
import { searchNotesEndpoint } from "./search-notes/endpoint.js";

export const searchRouter = Layer.mergeAll(
  HttpRouter.add("GET", "/api/vaults/:vaultId/search", searchNotesEndpoint),
  HttpRouter.add("GET", "/api/vaults/:vaultId/quick-switch", quickSwitchEndpoint),
  HttpRouter.add("GET", "/api/vaults/:vaultId/tags", listTagsEndpoint),
);
