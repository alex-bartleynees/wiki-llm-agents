import { ListThreadsRequest } from "@wiki-agents/contracts/threads/list-threads/request";
import { ListThreadsResponse } from "@wiki-agents/contracts/threads/list-threads/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { findVault } from "../../vaults/find-vault.js";
import { ThreadRepository } from "../repository.js";

export const listThreadsEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaPathParams(ListThreadsRequest);
  const vault = yield* findVault(request.vaultId);
  const threads = yield* (yield* ThreadRepository).listByVault(vault.id);
  return yield* HttpServerResponse.schemaJson(ListThreadsResponse)({ threads });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
  }),
  Effect.catch(internalError("list threads")),
);
