import { SaveBrowserSignInsRequest } from "@wiki-agents/contracts/projects/save-browser-sign-ins/request";
import { SaveBrowserSignInsResponse } from "@wiki-agents/contracts/projects/save-browser-sign-ins/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { saveBrowserSignIns } from "./use-case.js";

const Params = Schema.Struct({ projectId: Schema.String });

export const saveBrowserSignInsEndpoint = Effect.gen(function* () {
  const { projectId } = yield* HttpRouter.schemaPathParams(Params);
  const body = yield* HttpServerRequest.schemaBodyJson(SaveBrowserSignInsRequest);
  return yield* HttpServerResponse.schemaJson(SaveBrowserSignInsResponse)(yield* saveBrowserSignIns(projectId, body));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    InvalidProject: (error) => Effect.succeed(badRequest(error.message)),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
  }),
  Effect.catch(internalError("save browser sign-ins")),
);
