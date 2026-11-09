import { Schema } from "effect";

/**
 * Listens to a same-origin server-sent event stream, decoding each `data:` line with
 * the contract's schema. EventSource reconnects by itself; `onReconnect` runs after
 * each reconnect, since events sent while disconnected are not replayed.
 * Returns a function that closes the stream.
 */
export const listen = <S extends Schema.ConstraintDecoder<unknown>>(
  path: string,
  schema: S,
  handlers: { readonly onEvent: (event: S["Type"]) => void; readonly onReconnect?: () => void },
): (() => void) => {
  const decode = Schema.decodeUnknownSync(Schema.fromJsonString(schema));
  const source = new EventSource(path);
  let opened = false;
  source.addEventListener("open", () => {
    if (opened) handlers.onReconnect?.();
    opened = true;
  });
  source.addEventListener("message", (message: MessageEvent<string>) => {
    try {
      handlers.onEvent(decode(message.data) as S["Type"]);
    } catch (error) {
      console.warn("Ignoring an event that doesn't match the contract", error);
    }
  });
  return () => source.close();
};
