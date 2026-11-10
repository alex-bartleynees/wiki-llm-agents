import { ListThreadsQuery, ListThreadsRequest, VAULT_THREADS } from "@wiki-agents/contracts/threads/list-threads/request";
import { ListThreadsResponse } from "@wiki-agents/contracts/threads/list-threads/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { findVault } from "../../vaults/find-vault.js";
import { ThreadRepository } from "../repository.js";

export const listThreadsEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaPathParams(ListThreadsRequest);
  const vault = yield* findVault(request.vaultId);
  const query = yield* HttpServerRequest.schemaSearchParams(ListThreadsQuery);
  const scope = query.projectId === undefined ? undefined : { projectId: query.projectId === VAULT_THREADS ? null : query.projectId };
  const threads = yield* (yield* ThreadRepository).listByVault(vault.id, scope);
  return yield* HttpServerResponse.schemaJson(ListThreadsResponse)({ threads });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
  }),
  Effect.catch(internalError("list threads")),
);
