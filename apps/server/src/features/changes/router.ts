import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { getChangeEndpoint } from "./get-change/endpoint.js";
import { undoChangeEndpoint } from "./undo-change/endpoint.js";

export const changesRouter = Layer.mergeAll(
  HttpRouter.add("GET", "/api/changes/:changeId", getChangeEndpoint),
  HttpRouter.add("POST", "/api/changes/:changeId/undo", undoChangeEndpoint),
);
