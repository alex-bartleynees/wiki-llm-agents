import { ThreadsStreamMessage } from "@wiki-agents/contracts/threads/event";
import { Effect, Schema, Stream } from "effect";
import { internalError } from "../../../shared/http-errors.js";
import { sseFrame, sseResponse } from "../../../shared/sse.js";
import { streamAllThreads } from "./use-case.js";

const encode = Schema.encodeSync(Schema.fromJsonString(ThreadsStreamMessage));

export const streamAllThreadsEndpoint = Effect.gen(function* () {
  return yield* sseResponse((yield* streamAllThreads()).pipe(Stream.map((message) => sseFrame(encode(message)))));
}).pipe(Effect.catch(internalError("stream all threads")));
