import { Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { indexingRouter } from "../features/indexing/router.js";
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
  vaultsRouter,
  notesRouter,
  indexingRouter,
  searchRouter,
  pinsRouter,
  providersRouter,
  threadsRouter,
  webAppRouter,
);
