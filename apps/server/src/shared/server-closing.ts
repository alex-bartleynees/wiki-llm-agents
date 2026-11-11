import { createServer, type Server } from "node:http";
import { Context, Deferred, Effect, Exit, Layer } from "effect";

/**
 * Completes when the HTTP server starts closing. Streams that never end on their own
 * (SSE) end on it, so closing doesn't wait out the server's 20 s grace period for
 * them, and a restart (\`--watch\`) with a browser open is quick. Never completes
 * where nothing provides it (tests on an in-memory server).
 */
export const ServerClosing = Context.Reference<Effect.Effect<void>>("ServerClosing", { defaultValue: () => Effect.never });

/**
 * A Node HTTP server that signals `ServerClosing` as soon as `close()` is called
 * (Effect calls it on shutdown, then waits for open connections).
 */
export const makeClosingServer = () => {
  const closing = Deferred.makeUnsafe<void>();
  const server: Server = createServer();
  // The server listens before the app's handler is attached (the vault tools need its
  // address first). Node drops a request that has no handler, leaving the client
  // waiting forever, so until the app's handler is there, say so and close.
  server.on("request", (_request, response) => {
    if (server.listenerCount("request") > 1) return;
    response.writeHead(503, { "content-type": "text/plain", "retry-after": "1", connection: "close" }).end("Starting");
  });
  const close = server.close.bind(server);
  server.close = (callback) => {
    Deferred.doneUnsafe(closing, Exit.void);
    return close(callback);
  };
  return { server, closing: Layer.succeed(ServerClosing, Deferred.await(closing)) };
};
