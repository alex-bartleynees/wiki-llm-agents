import { GetTreeRequest } from "@wiki-agents/contracts/notes/get-tree/request";
import { GetTreeResponse } from "@wiki-agents/contracts/notes/get-tree/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { respondWithEtag } from "../../../shared/etag.js";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { getTreeEtag, getTreeForVault } from "./use-case.js";

export const getTreeEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaParams(GetTreeRequest);
  const { vaultId, etag } = yield* getTreeEtag(request);
  return yield* respondWithEtag(etag, () => Effect.flatMap(getTreeForVault(vaultId), HttpServerResponse.schemaJson(GetTreeResponse)));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
  }),
  Effect.catch(internalError("get tree")),
);
