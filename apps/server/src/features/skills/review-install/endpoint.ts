import { ReviewInstallRequest } from "@wiki-agents/contracts/skills/review-install/request";
import { ReviewInstallResponse } from "@wiki-agents/contracts/skills/review-install/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { skillErrors } from "../http.js";
import { Skills } from "../repository.js";

export const reviewInstallEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaBodyJson(ReviewInstallRequest);
  const skills = yield* Skills;
  return yield* HttpServerResponse.schemaJson(ReviewInstallResponse)(yield* skills.review(request));
}).pipe(skillErrors("review install"));
