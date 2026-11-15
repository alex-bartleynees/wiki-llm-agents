import { SaveCommitMessageSettingsRequest } from "@wiki-agents/contracts/projects/save-commit-message-settings/request";
import { SaveCommitMessageSettingsResponse } from "@wiki-agents/contracts/projects/save-commit-message-settings/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError } from "../../../shared/http-errors.js";
import { saveCommitMessageSettings } from "./use-case.js";

export const saveCommitMessageSettingsEndpoint = Effect.gen(function* () {
  const body = yield* HttpServerRequest.schemaBodyJson(SaveCommitMessageSettingsRequest);
  return yield* HttpServerResponse.schemaJson(SaveCommitMessageSettingsResponse)(yield* saveCommitMessageSettings(body));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    ProviderInstanceNotFound: () => Effect.succeed(badRequest("Unknown provider")),
  }),
  Effect.catch(internalError("save commit message settings")),
);
