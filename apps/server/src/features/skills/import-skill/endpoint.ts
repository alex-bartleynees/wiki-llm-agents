import { ImportSkillRequest } from "@wiki-agents/contracts/skills/import-skill/request";
import { ImportSkillResponse } from "@wiki-agents/contracts/skills/import-skill/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { skillErrors } from "../http.js";
import { Skills } from "../repository.js";

export const importSkillEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaBodyJson(ImportSkillRequest);
  const skills = yield* Skills;
  return yield* HttpServerResponse.schemaJson(ImportSkillResponse)(yield* skills.importFolder(request));
}).pipe(skillErrors("import skill"));
