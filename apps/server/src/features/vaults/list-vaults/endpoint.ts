import { ListVaultsRequest } from "@wiki-agents/contracts/vaults/list-vaults/request";
import { ListVaultsResponse } from "@wiki-agents/contracts/vaults/list-vaults/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError } from "../../../shared/http-errors.js";
import { VaultRepository } from "../repository.js";

export const listVaultsEndpoint = Effect.gen(function* () {
  yield* HttpServerRequest.schemaSearchParams(ListVaultsRequest);
  const repository = yield* VaultRepository;
  const response: ListVaultsResponse = { vaults: yield* repository.list };
  return yield* HttpServerResponse.schemaJson(ListVaultsResponse)(response);
}).pipe(
  Effect.catchTags({ SchemaError: () => Effect.succeed(badRequest()) }),
  Effect.catch(internalError("list vaults")),
);
