import { GetSkillRequest } from "@wiki-agents/contracts/skills/get-skill/request";
import { GetSkillResponse } from "@wiki-agents/contracts/skills/get-skill/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { skillErrors } from "../http.js";
import { Skills } from "../repository.js";

export const getSkillEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaSearchParams(GetSkillRequest);
  const skills = yield* Skills;
  return yield* HttpServerResponse.schemaJson(GetSkillResponse)(yield* skills.detail(request));
}).pipe(skillErrors("get skill"));
