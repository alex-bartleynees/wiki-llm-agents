import { ListFoldersRequest } from "@wiki-agents/contracts/folders/list-folders/request";
import { ListFoldersResponse } from "@wiki-agents/contracts/folders/list-folders/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { listFolders } from "./use-case.js";

export const listFoldersEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaSearchParams(ListFoldersRequest);
  const response = yield* listFolders(request.path);
  return yield* HttpServerResponse.schemaJson(ListFoldersResponse)(response);
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    FolderUnavailable: (error) => Effect.succeed(error.reason === "missing" ? notFound(error.message) : badRequest(error.message)),
  }),
  Effect.catch(internalError("list folders")),
);
