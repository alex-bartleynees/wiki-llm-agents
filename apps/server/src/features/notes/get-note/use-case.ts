import type { GetNoteRequest } from "@wiki-agents/contracts/notes/get-note/request";
import type { GetNoteResponse } from "@wiki-agents/contracts/notes/get-note/response";
import { vaultFileHref, viewHref } from "@wiki-agents/contracts/notes/model";
import { Effect, FileSystem } from "effect";
import { InvalidVaultPath } from "../errors.js";
import { findVault } from "../find-vault.js";
import { makeLinkIndex } from "../link-resolution.js";
import { resolveInVault } from "../path-guard.js";
import { renderNote } from "../render/render-note.js";
import { listVaultFiles } from "../vault-files.js";

/**
 * Reads a note and renders it. Until the index exists (slice 2) links are resolved
 * against a fresh walk of the vault, which takes a few milliseconds for ~1000 files.
 */
export const getNote = Effect.fn("getNote")(function* (request: GetNoteRequest) {
  const vault = yield* findVault(request.vaultId);
  if (!request.path.toLowerCase().endsWith(".md")) return yield* new InvalidVaultPath({ path: request.path });
  const { path, absolute } = yield* resolveInVault(vault.rootPath, request.path);
  const fs = yield* FileSystem.FileSystem;
  const markdown = yield* fs.readFileString(absolute);
  const index = makeLinkIndex(yield* listVaultFiles(vault.rootPath));
  const rendered = renderNote(markdown, {
    path,
    index,
    viewHref: (target) => viewHref(vault.id, target),
    fileHref: (target) => vaultFileHref(vault.id, target),
  });
  const response: GetNoteResponse = { vaultId: vault.id, path, ...rendered };
  return response;
});
