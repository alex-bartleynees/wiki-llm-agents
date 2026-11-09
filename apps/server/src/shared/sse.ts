import { Stream } from "effect";
import { HttpServerResponse } from "effect/http";

/** A comment line now and then keeps proxies and browsers from closing an idle stream. */
const HEARTBEAT = "25 seconds";

/** One server-sent event; `id` becomes the browser's `Last-Event-ID` on reconnect. */
export const sseFrame = (data: string, id?: number) => `${id === undefined ? "" : `id: ${id}\n`}data: ${data}\n\n`;

/** An event stream response from frames, with keep-alive comments; ends when `frames` ends. */
export const sseResponse = (frames: Stream.Stream<string>) =>
  HttpServerResponse.stream(
    Stream.encodeText(Stream.merge(frames, Stream.tick(HEARTBEAT).pipe(Stream.map(() => ": keep-alive\n\n")), { haltStrategy: "left" })),
    {
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache", "x-accel-buffering": "no" },
    },
  );
