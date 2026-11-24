import { ApplyInstallRequest } from "@wiki-agents/contracts/skills/apply-install/request";
import { ApplyInstallResponse } from "@wiki-agents/contracts/skills/apply-install/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { internalError } from "../../../shared/http-errors.js";
import { skillBodyResponses } from "../http.js";
import { applyInstall } from "./use-case.js";

export const applyInstallEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaBodyJson(ApplyInstallRequest);
  return yield* HttpServerResponse.schemaJson(ApplyInstallResponse)(yield* applyInstall(request));
}).pipe(
  Effect.catchTags(skillBodyResponses),
  Effect.catch(internalError("apply install")),
);
