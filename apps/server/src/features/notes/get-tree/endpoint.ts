import { GetTreeRequest } from "@wiki-agents/contracts/notes/get-tree/request";
import { GetTreeResponse } from "@wiki-agents/contracts/notes/get-tree/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { getTree } from "./use-case.js";

export const getTreeEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaParams(GetTreeRequest);
  return yield* HttpServerResponse.schemaJson(GetTreeResponse)(yield* getTree(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
  }),
  Effect.catch(internalError("get tree")),
);
