import { SaveRulesRequest } from "@wiki-agents/contracts/agents/save-rules/request";
import { SaveRulesResponse } from "@wiki-agents/contracts/agents/save-rules/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError } from "../../../shared/http-errors.js";
import { unprocessable } from "../config-errors.js";
import { saveRules } from "./use-case.js";

const Params = Schema.Struct({ rulesId: Schema.String });

export const saveRulesEndpoint = Effect.gen(function* () {
  const { rulesId } = yield* HttpRouter.schemaPathParams(Params);
  const body = yield* HttpServerRequest.schemaBodyJson(SaveRulesRequest);
  return yield* HttpServerResponse.schemaJson(SaveRulesResponse)(yield* saveRules({ ...body, rulesId }));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ConfigFileInvalid: (error) => Effect.succeed(unprocessable(error.problems)),
    ConfigFileChanged: () =>
      Effect.succeed(conflict("The rules file has changed since you opened it (on another machine, or by hand); look at it again before saving.")),
  }),
  Effect.catch(internalError("save rules")),
);
