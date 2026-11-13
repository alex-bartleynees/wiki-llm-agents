import { ListActiveThreadsResponse } from "@wiki-agents/contracts/threads/list-active-threads/response";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import { internalError } from "../../../shared/http-errors.js";
import { listActiveThreads } from "./use-case.js";

export const listActiveThreadsEndpoint = Effect.gen(function* () {
  const threads = yield* listActiveThreads();
  return yield* HttpServerResponse.schemaJson(ListActiveThreadsResponse)({ threads });
}).pipe(Effect.catch(internalError("list active threads")));
