import { ApplyInstallRequest } from "@wiki-agents/contracts/skills/apply-install/request";
import { ApplyInstallResponse } from "@wiki-agents/contracts/skills/apply-install/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { skillErrors } from "../http.js";
import { Skills } from "../repository.js";

export const applyInstallEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaBodyJson(ApplyInstallRequest);
  const skills = yield* Skills;
  return yield* HttpServerResponse.schemaJson(ApplyInstallResponse)(yield* skills.apply(request));
}).pipe(skillErrors("apply install"));
