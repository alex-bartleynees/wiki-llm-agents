import { changesRouter } from "../features/changes/router.js";
import { foldersRouter } from "../features/folders/router.js";
import { projectsRouter } from "../features/projects/router.js";
import { Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { agentsRouter } from "../features/agents/router.js";
import { indexingRouter } from "../features/indexing/router.js";
import { mcpRouter } from "../features/mcp/router.js";
import { notesRouter } from "../features/notes/router.js";
import { pinsRouter } from "../features/pins/router.js";
import { providersRouter } from "../features/providers/router.js";
import { searchRouter } from "../features/search/router.js";
import { threadsRouter } from "../features/threads/router.js";
import { vaultsRouter } from "../features/vaults/router.js";
import { webAppRouter } from "./web-app.js";

const healthRouter = HttpRouter.add("GET", "/health", HttpServerResponse.text("ok"));

export const router = Layer.mergeAll(
  healthRouter,
  foldersRouter,
  projectsRouter,
  vaultsRouter,
  notesRouter,
  indexingRouter,
  searchRouter,
  pinsRouter,
  providersRouter,
  threadsRouter,
  changesRouter,
  agentsRouter,
  mcpRouter,
  webAppRouter,
);
