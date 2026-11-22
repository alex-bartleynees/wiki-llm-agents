import { ListSkillsRequest } from "@wiki-agents/contracts/skills/list-skills/request";
import { ListSkillsResponse } from "@wiki-agents/contracts/skills/list-skills/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { skillErrors } from "../http.js";
import { Skills } from "../repository.js";

export const listSkillsEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaSearchParams(ListSkillsRequest);
  const skills = yield* Skills;
  return yield* HttpServerResponse.schemaJson(ListSkillsResponse)(yield* skills.list(request));
}).pipe(skillErrors("list skills"));
