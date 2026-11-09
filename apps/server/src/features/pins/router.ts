import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { listPinsEndpoint } from "./list-pins/endpoint.js";
import { pinNoteEndpoint } from "./pin-note/endpoint.js";
import { unpinNoteEndpoint } from "./unpin-note/endpoint.js";

export const pinsRouter = Layer.mergeAll(
  HttpRouter.add("GET", "/api/vaults/:vaultId/pins", listPinsEndpoint),
  HttpRouter.add("POST", "/api/vaults/:vaultId/pins", pinNoteEndpoint),
  HttpRouter.add("DELETE", "/api/vaults/:vaultId/pins", unpinNoteEndpoint),
);
