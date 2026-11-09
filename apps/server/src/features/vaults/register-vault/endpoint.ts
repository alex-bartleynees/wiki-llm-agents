import { RegisterVaultRequest } from "@wiki-agents/contracts/vaults/register-vault/request";
import { RegisterVaultResponse } from "@wiki-agents/contracts/vaults/register-vault/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError } from "../../../shared/http-errors.js";
import { registerVault } from "./use-case.js";

export const registerVaultEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaBodyJson(RegisterVaultRequest);
  const { vault, created } = yield* registerVault(request);
  const response: RegisterVaultResponse = { vault };
  return yield* HttpServerResponse.schemaJson(RegisterVaultResponse)(response, { status: created ? 201 : 200 });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    InvalidVaultFolder: (error) => Effect.succeed(badRequest(`${error.reason}: ${error.rootPath}`)),
  }),
  Effect.catch(internalError("register vault")),
);
