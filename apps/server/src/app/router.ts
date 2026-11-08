import { Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { vaultsRouter } from "../features/vaults/router.js";
import { webAppRouter } from "./web-app.js";

const healthRouter = HttpRouter.add("GET", "/health", HttpServerResponse.text("ok"));

export const router = Layer.mergeAll(healthRouter, vaultsRouter, webAppRouter);
