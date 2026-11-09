import { posix } from "node:path";
import type { GetFileRequest } from "@wiki-agents/contracts/notes/get-file/request";
import { Effect, FileSystem } from "effect";
import { findVault } from "../../vaults/find-vault.js";
import { resolveInVault } from "../../../shared/vault/path-guard.js";
import { withMemoryStorage } from "./memory-storage.js";

/** Types shown inline. Everything else is sent as a download. */
const INLINE_TYPES: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

/**
 * Locates a vault file through the path guard. HTML pages are read and returned with
 * the in-memory storage script added; other files are streamed from `absolute`.
 */
export const getFile = Effect.fn("getFile")(function* (request: GetFileRequest) {
  const vault = yield* findVault(request.vaultId);
  const { path, absolute } = yield* resolveInVault(vault.rootPath, request.path);
  const contentType = INLINE_TYPES[posix.extname(path).toLowerCase()];
  if (contentType?.startsWith("text/html")) {
    const fs = yield* FileSystem.FileSystem;
    const html = withMemoryStorage(yield* fs.readFileString(absolute));
    return { kind: "page" as const, path, contentType, html };
  }
  return { kind: "file" as const, path, absolute, contentType };
});
