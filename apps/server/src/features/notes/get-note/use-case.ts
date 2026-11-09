import type { GetNoteRequest } from "@wiki-agents/contracts/notes/get-note/request";
import type { GetNoteResponse } from "@wiki-agents/contracts/notes/get-note/response";
import { vaultFileHref, viewHref } from "@wiki-agents/contracts/notes/model";
import { Effect, FileSystem, Option } from "effect";
import { makeLinkIndex } from "../../../shared/markdown/link-resolution.js";
import { InvalidVaultPath } from "../../../shared/vault/errors.js";
import { resolveInVault } from "../../../shared/vault/path-guard.js";
import { VaultIndex } from "../../indexing/vault-index.js";
import { findVault } from "../../vaults/find-vault.js";
import { renderNote } from "../render/render-note.js";

/**
 * Reads a note from disk (always the current content) and renders it, resolving links
 * against the vault index's file list.
 */
export const getNote = Effect.fn("getNote")(function* (request: GetNoteRequest) {
  const vault = yield* findVault(request.vaultId);
  if (!request.path.toLowerCase().endsWith(".md")) return yield* new InvalidVaultPath({ path: request.path });
  const { path, absolute } = yield* resolveInVault(vault.rootPath, request.path);
  const fs = yield* FileSystem.FileSystem;
  const markdown = yield* fs.readFileString(absolute);
  const info = yield* fs.stat(absolute);
  const files = yield* (yield* VaultIndex).files(vault.id);
  const rendered = renderNote(markdown, {
    path,
    index: makeLinkIndex(files.map((file) => file.path)),
    viewHref: (target) => viewHref(vault.id, target),
    fileHref: (target) => vaultFileHref(vault.id, target),
  });
  const response: GetNoteResponse = {
    vaultId: vault.id,
    path,
    ...rendered,
    modifiedAt: Option.match(info.mtime, { onNone: () => 0, onSome: (date) => date.getTime() }),
  };
  return response;
});
