import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { getBacklinksEndpoint } from "./get-backlinks/endpoint.js";
import { getFileEndpoint } from "./get-file/endpoint.js";
import { getNoteEndpoint } from "./get-note/endpoint.js";
import { getNoteSourceEndpoint } from "./get-note-source/endpoint.js";
import { getTreeEndpoint } from "./get-tree/endpoint.js";
import { relatedNotesEndpoint } from "./related-notes/endpoint.js";
import { resolveLinksEndpoint } from "./resolve-links/endpoint.js";
import { saveNoteEndpoint } from "./save-note/endpoint.js";
import { uploadImageEndpoint } from "./upload-image/endpoint.js";

export const notesRouter = Layer.mergeAll(
  HttpRouter.add("GET", "/api/vaults/:vaultId/related", relatedNotesEndpoint),
  HttpRouter.add("GET", "/api/vaults/:vaultId/tree", getTreeEndpoint),
  HttpRouter.add("GET", "/api/vaults/:vaultId/note", getNoteEndpoint),
  HttpRouter.add("GET", "/api/vaults/:vaultId/note/source", getNoteSourceEndpoint),
  HttpRouter.add("PUT", "/api/vaults/:vaultId/note/source", saveNoteEndpoint),
  HttpRouter.add("POST", "/api/vaults/:vaultId/assets", uploadImageEndpoint),
  HttpRouter.add("GET", "/api/vaults/:vaultId/backlinks", getBacklinksEndpoint),
  HttpRouter.add("GET", "/api/vaults/:vaultId/files", getFileEndpoint),
  HttpRouter.add("POST", "/api/vaults/:vaultId/resolve-links", resolveLinksEndpoint),
);
