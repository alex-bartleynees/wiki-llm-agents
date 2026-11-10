import { ResolveLinksRequest } from "@wiki-agents/contracts/notes/resolve-links/request";
import { ResolveLinksResponse } from "@wiki-agents/contracts/notes/resolve-links/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { resolveLinks } from "./use-case.js";

const Params = Schema.Struct({ vaultId: Schema.String });

/** The vault comes from the route, the links from the body. */
export const resolveLinksEndpoint = Effect.gen(function* () {
  const { vaultId } = yield* HttpRouter.schemaPathParams(Params);
  const body = yield* HttpServerRequest.schemaBodyJson(ResolveLinksRequest);
  return yield* HttpServerResponse.schemaJson(ResolveLinksResponse)(yield* resolveLinks({ vaultId, links: body.links }));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
  }),
  Effect.catch(internalError("resolve links")),
);
