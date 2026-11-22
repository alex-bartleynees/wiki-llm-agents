import { GetSettingsRequest } from "@wiki-agents/contracts/skills/get-settings/request";
import { GetSettingsResponse } from "@wiki-agents/contracts/skills/get-settings/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { skillErrors } from "../http.js";
import { Skills } from "../repository.js";

export const getSettingsEndpoint = Effect.gen(function* () {
  yield* HttpServerRequest.schemaSearchParams(GetSettingsRequest);
  const skills = yield* Skills;
  return yield* HttpServerResponse.schemaJson(GetSettingsResponse)(yield* skills.settings());
}).pipe(skillErrors("get settings"));
