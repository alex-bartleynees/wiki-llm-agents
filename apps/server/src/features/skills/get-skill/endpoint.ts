import { GetSkillRequest } from "@wiki-agents/contracts/skills/get-skill/request";
import { GetSkillResponse } from "@wiki-agents/contracts/skills/get-skill/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { internalError } from "../../../shared/http-errors.js";
import { skillResponses } from "../http.js";
import { Skills } from "../skills.js";

export const getSkillEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaSearchParams(GetSkillRequest);
  const skills = yield* Skills;
  return yield* HttpServerResponse.schemaJson(GetSkillResponse)(yield* skills.detail(request));
}).pipe(
  Effect.catchTags(skillResponses),
  Effect.catch(internalError("get skill")),
);
