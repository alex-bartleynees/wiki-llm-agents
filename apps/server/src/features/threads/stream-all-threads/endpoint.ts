import { Effect } from "effect";
import { internalError } from "../../../shared/http-errors.js";
import { sseResponse } from "../../../shared/sse.js";
import { streamAllThreads } from "./use-case.js";

export const streamAllThreadsEndpoint = Effect.gen(function* () {
  return yield* sseResponse(yield* streamAllThreads());
}).pipe(Effect.catch(internalError("stream all threads")));
