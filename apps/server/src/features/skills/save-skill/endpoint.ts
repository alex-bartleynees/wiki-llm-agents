import { SaveSkillRequest } from "@wiki-agents/contracts/skills/save-skill/request";
import { SaveSkillResponse } from "@wiki-agents/contracts/skills/save-skill/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { internalError } from "../../../shared/http-errors.js";
import { skillBodyResponses } from "../http.js";
import { saveSkill } from "./use-case.js";

export const saveSkillEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaBodyJson(SaveSkillRequest);
  return yield* HttpServerResponse.schemaJson(SaveSkillResponse)(yield* saveSkill(request));
}).pipe(
  Effect.catchTags(skillBodyResponses),
  Effect.catch(internalError("save skill")),
);
