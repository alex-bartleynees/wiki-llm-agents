import { SaveSettingsRequest } from "@wiki-agents/contracts/skills/save-settings/request";
import { SaveSettingsResponse } from "@wiki-agents/contracts/skills/save-settings/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { internalError } from "../../../shared/http-errors.js";
import { skillBodyResponses } from "../http.js";
import { Skills } from "../repository.js";

export const saveSettingsEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaBodyJson(SaveSettingsRequest);
  const skills = yield* Skills;
  return yield* HttpServerResponse.schemaJson(SaveSettingsResponse)(yield* skills.configure(request));
}).pipe(
  Effect.catchTags(skillBodyResponses),
  Effect.catch(internalError("save settings")),
);
