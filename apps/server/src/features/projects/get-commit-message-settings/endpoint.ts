import { GetCommitMessageSettingsResponse } from "@wiki-agents/contracts/projects/get-commit-message-settings/response";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import { internalError } from "../../../shared/http-errors.js";
import { settingsView } from "../commit-message-settings.js";

export const getCommitMessageSettingsEndpoint = Effect.gen(function* () {
  return yield* HttpServerResponse.schemaJson(GetCommitMessageSettingsResponse)(yield* settingsView);
}).pipe(Effect.catch(internalError("get commit message settings")));
