import { Effect, Stream } from "effect";
import { HttpServerResponse } from "effect/http";
import { ServerClosing } from "./server-closing.js";

const HEARTBEAT = "25 seconds";

export const sseFrame = (data: string) => `data: ${data}\n\n`;

export const sseResponse = (frames: Stream.Stream<string>) =>
  Effect.map(ServerClosing, (closing) =>
    HttpServerResponse.stream(
      Stream.encodeText(
        Stream.merge(frames, Stream.tick(HEARTBEAT).pipe(Stream.map(() => ": keep-alive\n\n")), { haltStrategy: "left" }).pipe(
          Stream.interruptWhen(closing),
        ),
      ),
      {
        contentType: "text/event-stream",
        headers: { "cache-control": "no-cache", "x-accel-buffering": "no" },
      },
    ),
  );
