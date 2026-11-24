import { RecoverInstallRequest } from "@wiki-agents/contracts/skills/recover-install/request";
import { RecoverInstallResponse } from "@wiki-agents/contracts/skills/recover-install/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { internalError } from "../../../shared/http-errors.js";
import { skillBodyResponses } from "../http.js";
import { recoverInstall } from "./use-case.js";

export const recoverInstallEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaBodyJson(RecoverInstallRequest);
  return yield* HttpServerResponse.schemaJson(RecoverInstallResponse)(yield* recoverInstall(request));
}).pipe(
  Effect.catchTags(skillBodyResponses),
  Effect.catch(internalError("recover install")),
);
