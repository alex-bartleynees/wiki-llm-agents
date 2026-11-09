import { PinNoteRequest } from "@wiki-agents/contracts/pins/pin-note/request";
import { PinNoteResponse } from "@wiki-agents/contracts/pins/pin-note/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { pinNote } from "./use-case.js";

const Params = Schema.Struct({ vaultId: Schema.String });

/** The vault comes from the route, the path from the body. */
export const pinNoteEndpoint = Effect.gen(function* () {
  const { vaultId } = yield* HttpRouter.schemaPathParams(Params);
  const body = yield* HttpServerRequest.schemaBodyJson(PinNoteRequest);
  return yield* HttpServerResponse.schemaJson(PinNoteResponse)(yield* pinNote({ vaultId, path: body.path }));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    InvalidVaultPath: () => Effect.succeed(badRequest("Invalid path")),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
    VaultFileNotFound: () => Effect.succeed(notFound("File not found")),
  }),
  Effect.catch(internalError("pin note")),
);
