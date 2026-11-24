import { ImportSkillRequest } from "@wiki-agents/contracts/skills/import-skill/request";
import { ImportSkillResponse } from "@wiki-agents/contracts/skills/import-skill/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { internalError } from "../../../shared/http-errors.js";
import { skillBodyResponses } from "../http.js";
import { importSkill } from "./use-case.js";

export const importSkillEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaBodyJson(ImportSkillRequest);
  return yield* HttpServerResponse.schemaJson(ImportSkillResponse)(yield* importSkill(request));
}).pipe(
  Effect.catchTags(skillBodyResponses),
  Effect.catch(internalError("import skill")),
);
