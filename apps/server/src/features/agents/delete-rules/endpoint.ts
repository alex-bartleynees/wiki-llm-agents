import { DeleteRulesRequest } from "@wiki-agents/contracts/agents/delete-rules/request";
import { DeleteRulesResponse } from "@wiki-agents/contracts/agents/delete-rules/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { deleteRules } from "./use-case.js";

export const deleteRulesEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaParams(DeleteRulesRequest);
  return yield* HttpServerResponse.schemaJson(DeleteRulesResponse)(yield* deleteRules(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ConfigFileInvalid: () => Effect.succeed(badRequest("Invalid rules id")),
    ConfigFileNotFound: () => Effect.succeed(notFound("Rules not found")),
    ConfigFileChanged: () => Effect.succeed(conflict("The rules file has changed since you opened it; look at it again before deleting.")),
  }),
  Effect.catch(internalError("delete rules")),
);
