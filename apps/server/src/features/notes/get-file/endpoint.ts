import { posix } from "node:path";
import { GetFileRequest } from "@wiki-agents/contracts/notes/get-file/request";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { getFile } from "./use-case.js";

/**
 * Vault files are untrusted content served from the app's own origin, so every
 * response carries a CSP `sandbox`: the browser gives the document an opaque origin
 * (no access to the app's DOM, storage, or API) whether it is framed by the app or
 * opened directly in a tab. `no-referrer` keeps vault paths out of requests to CDNs.
 */
const UNTRUSTED_HEADERS = {
  "cache-control": "no-cache",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

/** Images, SVGs, PDFs, downloads: no script at all. */
export const STATIC_FILE_POLICY = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";

/** CDNs that HTML pages in the vault (charts, reports) may load scripts and styles from. */
const PAGE_CDNS = "https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com";

/**
 * HTML pages: scripts run (the vault's reports are Vue + Chart.js apps) but only in an
 * opaque origin, with no way to send data anywhere: no fetch/XHR/WebSocket, images
 * only from the app or data: URLs, no forms, popups, or top-level navigation, no
 * `<base>`, and only the app may frame them. Never add `allow-same-origin`.
 */
export const HTML_PAGE_POLICY = [
  "sandbox allow-scripts",
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' ${PAGE_CDNS}`,
  `style-src 'unsafe-inline' ${PAGE_CDNS}`,
  "img-src 'self' data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join("; ");

export const getFileEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaParams(GetFileRequest);
  const file = yield* getFile(request);
  if (file.kind === "page") {
    return HttpServerResponse.text(file.html, {
      contentType: file.contentType,
      headers: { ...UNTRUSTED_HEADERS, "content-security-policy": HTML_PAGE_POLICY, "content-disposition": "inline" },
    });
  }
  const disposition =
    file.contentType === undefined
      ? `attachment; filename*=UTF-8''${encodeURIComponent(posix.basename(file.path))}`
      : "inline";
  return yield* HttpServerResponse.file(file.absolute, {
    contentType: file.contentType ?? "application/octet-stream",
    headers: { ...UNTRUSTED_HEADERS, "content-security-policy": STATIC_FILE_POLICY, "content-disposition": disposition },
  });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    InvalidVaultPath: () => Effect.succeed(badRequest("Invalid file path")),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
    VaultFileNotFound: () => Effect.succeed(notFound("File not found")),
  }),
  Effect.catch(internalError("get file")),
);
