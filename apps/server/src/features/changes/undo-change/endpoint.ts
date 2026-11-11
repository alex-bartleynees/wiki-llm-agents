import { UndoChangeRequest } from "@wiki-agents/contracts/changes/undo-change/request";
import { UndoChangeResponse } from "@wiki-agents/contracts/changes/undo-change/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { undoChange } from "./use-case.js";

export const undoChangeEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaPathParams(UndoChangeRequest);
  return yield* HttpServerResponse.schemaJson(UndoChangeResponse)(yield* undoChange(request.changeId));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ChangeNotFound: () => Effect.succeed(notFound("Change not found")),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
    InvalidVaultPath: () => Effect.succeed(badRequest("The change's path is no longer inside the vault")),
    ChangeUndoneAlready: () => Effect.succeed(conflict("This change was undone already.")),
    ChangeConflict: () => Effect.succeed(conflict("The file has changed since this turn; undo would lose those edits.")),
  }),
  Effect.catch(internalError("undo change")),
);
