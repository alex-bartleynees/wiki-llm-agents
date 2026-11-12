import { UpdateVaultRequest } from "@wiki-agents/contracts/vaults/update-vault/request";
import { UpdateVaultResponse } from "@wiki-agents/contracts/vaults/update-vault/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { updateVault } from "./use-case.js";

const Params = Schema.Struct({ vaultId: Schema.String });

export const updateVaultEndpoint = Effect.gen(function* () {
  const { vaultId } = yield* HttpRouter.schemaPathParams(Params);
  const body = yield* HttpServerRequest.schemaBodyJson(UpdateVaultRequest);
  const response: UpdateVaultResponse = { vault: yield* updateVault({ vaultId, ...body }) };
  return yield* HttpServerResponse.schemaJson(UpdateVaultResponse)(response);
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    InvalidTemplateFolder: (error) => Effect.succeed(badRequest(`${error.reason}: ${error.folder}`)),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
  }),
  Effect.catch(internalError("update vault")),
);
