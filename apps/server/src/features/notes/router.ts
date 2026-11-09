import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { getFileEndpoint } from "./get-file/endpoint.js";
import { getNoteEndpoint } from "./get-note/endpoint.js";
import { getTreeEndpoint } from "./get-tree/endpoint.js";

export const notesRouter = Layer.mergeAll(
  HttpRouter.add("GET", "/api/vaults/:vaultId/tree", getTreeEndpoint),
  HttpRouter.add("GET", "/api/vaults/:vaultId/note", getNoteEndpoint),
  HttpRouter.add("GET", "/api/vaults/:vaultId/files", getFileEndpoint),
);
