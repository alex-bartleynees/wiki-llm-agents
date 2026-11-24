import { GetSettingsRequest } from "@wiki-agents/contracts/skills/get-settings/request";
import { GetSettingsResponse } from "@wiki-agents/contracts/skills/get-settings/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { internalError } from "../../../shared/http-errors.js";
import { skillResponses } from "../http.js";
import { Skills } from "../skills.js";

export const getSettingsEndpoint = Effect.gen(function* () {
  yield* HttpServerRequest.schemaSearchParams(GetSettingsRequest);
  const skills = yield* Skills;
  return yield* HttpServerResponse.schemaJson(GetSettingsResponse)(yield* skills.settings());
}).pipe(
  Effect.catchTags(skillResponses),
  Effect.catch(internalError("get settings")),
);
