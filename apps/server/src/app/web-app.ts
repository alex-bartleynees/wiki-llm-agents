import { join } from "node:path";
import { Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerResponse, HttpStaticServer } from "effect/http";
import { AppConfig } from "../shared/config.js";

/** Vite's content-hashed build output: a changed file gets a new name, so cache it forever. */
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
/** Everything else (index.html above all) must be revalidated, using the ETag. */
export const REVALIDATE_CACHE = "no-cache";

/** Server-owned paths. An unknown path under these is a 404, never the app shell. */
const SERVER_PREFIXES = ["/api", "/mcp", "/events"] as const;

const notFound = HttpServerResponse.text("Not found", { status: 404 });

/**
 * Serves the built SvelteKit SPA from `root`:
 * - `/_app/immutable/*` with a long-lived cache
 * - other files with revalidation, and `index.html` for deep links (paths without an
 *   extension, from requests that accept HTML), so the client router can render them
 * - unknown `/api`, `/mcp`, `/events` paths as plain 404s
 * Exact API routes registered elsewhere still win over these wildcards.
 */
export const makeWebAppRouter = (root: string) =>
  Layer.mergeAll(
    HttpStaticServer.layer({
      root: join(root, "_app", "immutable"),
      prefix: "/_app/immutable",
      cacheControl: IMMUTABLE_CACHE,
    }),
    HttpStaticServer.layer({ root, spa: true, cacheControl: REVALIDATE_CACHE }),
    ...SERVER_PREFIXES.map((prefix) => HttpRouter.add("*", `${prefix}/*`, notFound)),
  );

/** Mounted only when WIKI_AGENTS_STATIC_DIR is set; in development Vite serves the UI. */
export const webAppRouter = Layer.unwrap(
  Effect.gen(function* () {
    const staticDir = yield* AppConfig.staticDir;
    return Option.match(staticDir, {
      onNone: () => Layer.empty,
      onSome: makeWebAppRouter,
    });
  }),
);
