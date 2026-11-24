import { ListSkillsRequest } from "@wiki-agents/contracts/skills/list-skills/request";
import { ListSkillsResponse } from "@wiki-agents/contracts/skills/list-skills/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { internalError } from "../../../shared/http-errors.js";
import { skillResponses } from "../http.js";
import { Skills } from "../skills.js";

export const listSkillsEndpoint = Effect.gen(function* () {
  yield* HttpServerRequest.schemaSearchParams(ListSkillsRequest);
  const skills = yield* Skills;
  return yield* HttpServerResponse.schemaJson(ListSkillsResponse)(yield* skills.list());
}).pipe(
  Effect.catchTags(skillResponses),
  Effect.catch(internalError("list skills")),
);
