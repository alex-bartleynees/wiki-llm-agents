import { createHash } from "node:crypto";
import type { GetNoteRequest } from "@wiki-agents/contracts/notes/get-note/request";
import type { GetNoteResponse } from "@wiki-agents/contracts/notes/get-note/response";
import { vaultFileHref, viewHref } from "@wiki-agents/contracts/notes/model";
import { Effect, FileSystem, Option } from "effect";
import type { LinkIndex } from "../../../shared/markdown/link-resolution.js";
import { InvalidVaultPath } from "../../../shared/vault/errors.js";
import { resolveInVault } from "../../../shared/vault/path-guard.js";
import { ChangeLog } from "../../changes/change-log.js";
import { VaultIndex } from "../../indexing/vault-index.js";
import { findVault } from "../../vaults/find-vault.js";
import { type RenderedNote, renderNote } from "../render/render-note.js";

const RENDER_CACHE_MAX = 200;

interface CachedRender {
  readonly markdown: string;
  readonly markdownHash: string;
  readonly index: LinkIndex;
  readonly rendered: RenderedNote;
}

const renderCache = new Map<string, CachedRender>();

const hashText = (text: string) => createHash("sha256").update(text).digest("base64url").slice(0, 24);

const getCachedRender = (key: string, markdown: string, index: LinkIndex): CachedRender | undefined => {
  const entry = renderCache.get(key);
  if (entry === undefined || entry.markdown !== markdown || entry.index !== index) return undefined;
  renderCache.delete(key);
  renderCache.set(key, entry);
  return entry;
};

const putCachedRender = (key: string, entry: CachedRender) => {
  renderCache.delete(key);
  renderCache.set(key, entry);
  if (renderCache.size > RENDER_CACHE_MAX) renderCache.delete(renderCache.keys().next().value!);
};

export const getNoteWithEtag = Effect.fn("getNoteWithEtag")(function* (request: GetNoteRequest) {
  const vault = yield* findVault(request.vaultId);
  if (!request.path.toLowerCase().endsWith(".md")) return yield* new InvalidVaultPath({ path: request.path });
  const { path, absolute } = yield* resolveInVault(vault.rootPath, request.path);
  const fs = yield* FileSystem.FileSystem;
  const vaultIndex = yield* VaultIndex;
  const changeLog = yield* ChangeLog;
  const [markdown, info, index, treeEtag, lastAgentEdit] = yield* Effect.all(
    [
      fs.readFileString(absolute),
      fs.stat(absolute),
      vaultIndex.linkIndex(vault.id),
      vaultIndex.treeEtag(vault.id),
      changeLog.lastAgentEdit(vault.id, path),
    ],
    { concurrency: "unbounded" },
  );
  const cacheKey = `${vault.id}\0${path}`;
  let cached = getCachedRender(cacheKey, markdown, index);
  if (cached === undefined) {
    const rendered = renderNote(markdown, {
      path,
      index,
      viewHref: (target) => viewHref(vault.id, target),
      fileHref: (target) => vaultFileHref(vault.id, target),
    });
    cached = { markdown, markdownHash: hashText(markdown), index, rendered };
    putCachedRender(cacheKey, cached);
  }
  const modifiedAt = Option.match(info.mtime, { onNone: () => 0, onSome: (date) => date.getTime() });
  const edit = Option.getOrNull(lastAgentEdit);
  const editKey = edit === null ? "" : `${edit.at}:${edit.threadId}:${edit.actor}`;
  const etag = `"${hashText(`${vault.id}\0${path}\0${cached.markdownHash}\0${treeEtag}\0${modifiedAt}\0${editKey}`)}"`;
  const response: GetNoteResponse = {
    vaultId: vault.id,
    path,
    ...cached.rendered,
    modifiedAt,
    lastAgentEdit: edit,
  };
  return { response, etag };
});

export const getNote = (request: GetNoteRequest) => Effect.map(getNoteWithEtag(request), ({ response }) => response);
