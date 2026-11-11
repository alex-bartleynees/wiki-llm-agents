import { GetChangeRequest } from "@wiki-agents/contracts/changes/get-change/request";
import { GetChangeResponse } from "@wiki-agents/contracts/changes/get-change/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { getChange } from "./use-case.js";

export const getChangeEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaPathParams(GetChangeRequest);
  return yield* HttpServerResponse.schemaJson(GetChangeResponse)(yield* getChange(request.changeId));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ChangeNotFound: () => Effect.succeed(notFound("Change not found")),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
    InvalidVaultPath: () => Effect.succeed(badRequest("The change's path is no longer inside the vault")),
  }),
  Effect.catch(internalError("get change")),
);
