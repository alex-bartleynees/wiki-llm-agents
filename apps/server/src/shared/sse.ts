import { Effect, Stream } from "effect";
import { HttpServerResponse } from "effect/http";
import { ServerClosing } from "./server-closing.js";

/** A comment line now and then keeps proxies and browsers from closing an idle stream. */
const HEARTBEAT = "25 seconds";

/** One server-sent event; `id` becomes the browser's `Last-Event-ID` on reconnect. */
export const sseFrame = (data: string, id?: number) => `${id === undefined ? "" : `id: ${id}\n`}data: ${data}\n\n`;

/**
 * An event stream response from frames, with keep-alive comments. Ends when `frames`
 * ends or the server starts closing; the browser reconnects and resumes from its
 * last event id.
 */
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
