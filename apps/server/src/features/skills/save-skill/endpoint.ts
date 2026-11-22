import { SaveSkillRequest } from "@wiki-agents/contracts/skills/save-skill/request";
import { SaveSkillResponse } from "@wiki-agents/contracts/skills/save-skill/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { skillErrors } from "../http.js";
import { Skills } from "../repository.js";

export const saveSkillEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaBodyJson(SaveSkillRequest);
  const skills = yield* Skills;
  return yield* HttpServerResponse.schemaJson(SaveSkillResponse)(yield* skills.save(request));
}).pipe(skillErrors("save skill"));
