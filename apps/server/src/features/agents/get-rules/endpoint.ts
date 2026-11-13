import { GetRulesRequest } from "@wiki-agents/contracts/agents/get-rules/request";
import { GetRulesResponse } from "@wiki-agents/contracts/agents/get-rules/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { getRules } from "./use-case.js";

export const getRulesEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaPathParams(GetRulesRequest);
  return yield* HttpServerResponse.schemaJson(GetRulesResponse)(yield* getRules(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ConfigFileInvalid: () => Effect.succeed(notFound("Rules not found")),
    ConfigFileNotFound: () => Effect.succeed(notFound("Rules not found")),
  }),
  Effect.catch(internalError("get rules")),
);
