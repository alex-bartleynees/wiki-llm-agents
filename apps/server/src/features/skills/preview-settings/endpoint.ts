import { PreviewSettingsRequest } from "@wiki-agents/contracts/skills/preview-settings/request";
import { PreviewSettingsResponse } from "@wiki-agents/contracts/skills/preview-settings/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { skillErrors } from "../http.js";
import { Skills } from "../repository.js";

export const previewSettingsEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaBodyJson(PreviewSettingsRequest);
  const skills = yield* Skills;
  return yield* HttpServerResponse.schemaJson(PreviewSettingsResponse)(yield* skills.previewSettings(request));
}).pipe(skillErrors("preview skills settings"));
