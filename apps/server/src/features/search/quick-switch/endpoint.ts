import { QuickSwitchRequest } from "@wiki-agents/contracts/search/quick-switch/request";
import { QuickSwitchResponse } from "@wiki-agents/contracts/search/quick-switch/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { quickSwitch } from "./use-case.js";

export const quickSwitchEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaParams(QuickSwitchRequest);
  return yield* HttpServerResponse.schemaJson(QuickSwitchResponse)(yield* quickSwitch(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
  }),
  Effect.catch(internalError("quick switch")),
);
