import { RecoverInstallRequest } from "@wiki-agents/contracts/skills/recover-install/request";
import { RecoverInstallResponse } from "@wiki-agents/contracts/skills/recover-install/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { skillErrors } from "../http.js";
import { Skills } from "../repository.js";

export const recoverInstallEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaBodyJson(RecoverInstallRequest);
  const skills = yield* Skills;
  return yield* HttpServerResponse.schemaJson(RecoverInstallResponse)(yield* skills.recover(request));
}).pipe(skillErrors("recover install"));
