/**
 * Vault files and message attachments are untrusted content served from the app's
 * own origin, so every response carries a CSP `sandbox`: the browser gives the
 * document an opaque origin (no access to the app's DOM, storage, or API) whether it
 * is framed by the app or opened directly in a tab. `no-referrer` keeps paths out of
 * requests to CDNs.
 */
export const UNTRUSTED_HEADERS = {
  "cache-control": "no-cache",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

/** Images, SVGs, PDFs, downloads: no script at all. */
export const STATIC_FILE_POLICY = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";

/** `attachment; filename*=…`: the browser downloads the file under its name. */
export const downloadDisposition = (name: string) => `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
