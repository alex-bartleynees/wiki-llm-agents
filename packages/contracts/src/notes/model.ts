import { Schema } from "effect";

/**
 * How the app shows a vault file: `note` (markdown, rendered), `page` (HTML, in a
 * sandboxed frame), `json` (a collapsible tree), or `file` (raw: images, PDFs...).
 */
export const FileKind = Schema.Literals(["note", "page", "json", "file"]);
export type FileKind = typeof FileKind.Type;

export const fileKind = (path: string): FileKind => {
  const lower = path.toLowerCase();
  if (lower.endsWith(".md")) return "note";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "page";
  if (lower.endsWith(".json")) return "json";
  return "file";
};

/** A file in a vault, by its vault-relative path with `/` separators. */
export const TreeEntry = Schema.Struct({
  path: Schema.String,
  kind: FileKind,
});
export type TreeEntry = typeof TreeEntry.Type;

/** A link found in a note while rendering it. */
export const NoteLink = Schema.Struct({
  /** The target as written, without alias or heading (`Some Note`, `assets/a.png`). */
  target: Schema.String,
  /** The vault-relative path it resolved to, or null when unresolved. */
  path: Schema.NullOr(Schema.String),
  kind: Schema.Literals(["wikilink", "embed", "markdown"]),
});
export type NoteLink = typeof NoteLink.Type;

/*
 * App and file URLs. The server writes these into rendered note HTML and the web app
 * routes on them, so both sides share one definition. Views use a query parameter
 * rather than a path segment because names often contain dots, which the static
 * server would treat as file extensions.
 */
const encodePath = (path: string) => encodeURIComponent(path).replaceAll("%2F", "/");

/** The query parameter of each in-app view; raw files have none. */
export const VIEW_PARAMS = { note: "note", page: "page", json: "json" } as const;

const vaultHref = (vaultId: string, param: string, path: string) =>
  `/vaults/${encodeURIComponent(vaultId)}?${param}=${encodePath(path)}`;

export const noteHref = (vaultId: string, path: string) => vaultHref(vaultId, VIEW_PARAMS.note, path);

/** Where the app shows this file, or undefined when it is only available raw. */
export const viewHref = (vaultId: string, path: string): string | undefined => {
  const kind = fileKind(path);
  return kind === "file" ? undefined : vaultHref(vaultId, VIEW_PARAMS[kind], path);
};

/** The raw file. Every response from here is sandboxed by the server's CSP. */
export const vaultFileHref = (vaultId: string, path: string) =>
  `/api/vaults/${encodeURIComponent(vaultId)}/files?path=${encodePath(path)}`;
