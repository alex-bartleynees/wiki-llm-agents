import { Schema } from "effect";

/** Waits before reopening a stream the browser gave up on: 1 s, doubling up to 30 s. */
const RETRY_MS = { first: 1000, max: 30_000 } as const;

/**
 * Listens to a same-origin server-sent event stream, decoding each `data:` line with
 * the contract's schema. `onReconnect` runs after each reconnect, since a stream
 * without replay loses the events sent while it was away.
 *
 * EventSource retries a dropped connection by itself, but gives up for good after a
 * response that isn't an event stream (a proxy's 502 while the server restarts);
 * then this opens a new one after a backoff. A function `path` is called again for
 * that, so a stream with replay can ask to resume from what it has (a new
 * EventSource doesn't carry over the old one's `Last-Event-ID`).
 * Returns a function that closes the stream.
 */
export const listen = <S extends Schema.ConstraintDecoder<unknown>>(
  path: string | (() => string),
  schema: S,
  handlers: { readonly onEvent: (event: S["Type"]) => void; readonly onReconnect?: () => void },
): (() => void) => {
  const decode = Schema.decodeUnknownSync(Schema.fromJsonString(schema));
  let source: EventSource | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay: number = RETRY_MS.first;
  let opened = false;
  let closed = false;

  const open = () => {
    const current = (source = new EventSource(typeof path === "string" ? path : path()));
    current.addEventListener("open", () => {
      delay = RETRY_MS.first;
      if (opened) handlers.onReconnect?.();
      opened = true;
    });
    current.addEventListener("message", (message: MessageEvent<string>) => {
      try {
        handlers.onEvent(decode(message.data) as S["Type"]);
      } catch (error) {
        console.warn("Ignoring an event that doesn't match the contract", error);
      }
    });
    current.addEventListener("error", () => {
      if (closed || current.readyState !== EventSource.CLOSED) return;
      retry = setTimeout(open, delay);
      delay = Math.min(delay * 2, RETRY_MS.max);
    });
  };

  open();
  return () => {
    closed = true;
    clearTimeout(retry);
    source?.close();
  };
};
