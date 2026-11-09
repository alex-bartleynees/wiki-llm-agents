import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileKind } from "@wiki-agents/contracts/notes/model";
import type { Vault } from "@wiki-agents/contracts/vaults/model";
import { Effect, FileSystem, Option } from "effect";
import { extractNote } from "../../shared/markdown/extract.js";
import { makeLinkIndex, resolveLinkTarget, resolveMarkdownTarget } from "../../shared/markdown/link-resolution.js";
import { normaliseVaultPath, resolveInVault } from "../../shared/vault/path-guard.js";
import { listVaultFiles } from "../../shared/vault/vault-files.js";
import { type IndexedFileWithHash, IndexStore } from "./store.js";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const utf8 = new TextDecoder();

/**
 * Brings the vault's index in line with the disk and returns the paths that changed
 * (added, modified, removed), sorted. `scope` is "all" or the paths to look at; a
 * path that is now a folder means a full scan, and a path that is gone also removes
 * everything indexed under it (a deleted or moved folder).
 *
 * A file is re-read only when its size or mtime changed, and a note re-parsed only
 * when its hash changed. When anything changed, every link in the vault is
 * re-resolved, which also handles renames: links to the old path become unresolved
 * or resolve to the new one, as in Obsidian.
 */
export const reconcileVault = Effect.fnUntraced(function* (vault: Vault, scope: "all" | ReadonlySet<string>) {
  const fs = yield* FileSystem.FileSystem;
  const store = yield* IndexStore;
  const root = yield* fs.realPath(vault.rootPath);
  const indexed = new Map<string, IndexedFileWithHash>((yield* store.files(vault.id)).map((file) => [file.path, file]));

  let candidates = new Set<string>();
  let gone = new Set<string>();
  let full = scope === "all";
  if (scope !== "all") {
    for (const raw of scope) {
      const path = normaliseVaultPath(raw);
      if (path === undefined) continue;
      const resolved = yield* resolveInVault(root, path).pipe(Effect.option);
      const info = Option.isSome(resolved) ? yield* fs.stat(resolved.value.absolute).pipe(Effect.option) : Option.none();
      if (Option.isNone(info)) {
        gone.add(path);
        for (const known of indexed.keys()) if (known.startsWith(`${path}/`)) gone.add(known);
      } else if (info.value.type === "Directory") {
        full = true;
        break;
      } else if (info.value.type === "File") {
        candidates.add(path);
      } else {
        gone.add(path);
      }
    }
  }
  if (full) {
    candidates = new Set(yield* listVaultFiles(root));
    gone = new Set([...indexed.keys()].filter((path) => !candidates.has(path)));
  }

  const changed = new Set<string>();
  for (const path of candidates) {
    const absolute = join(root, path);
    const info = yield* fs.stat(absolute).pipe(Effect.option);
    if (Option.isNone(info) || info.value.type !== "File") {
      gone.add(path);
      continue;
    }
    const file = {
      path,
      kind: fileKind(path),
      mtimeMs: Option.match(info.value.mtime, { onNone: () => 0, onSome: (date) => date.getTime() }),
      size: Number(info.value.size),
    };
    const previous = indexed.get(path);
    if (previous !== undefined && previous.mtimeMs === file.mtimeMs && previous.size === file.size && previous.kind === file.kind) {
      continue;
    }
    if (file.kind !== "note") {
      yield* store.putFile(vault.id, file);
      changed.add(path);
      continue;
    }
    const bytes = yield* fs.readFile(absolute).pipe(Effect.option);
    if (Option.isNone(bytes)) {
      gone.add(path);
      continue;
    }
    const contentHash = sha256(bytes.value);
    if (previous?.contentHash === contentHash) {
      // Touched but not changed (a save without edits, a sync): only the mtime moves.
      yield* store.putFile(vault.id, file);
      continue;
    }
    const content = utf8.decode(bytes.value);
    yield* store.putNote(vault.id, file, { ...extractNote(content, path), content, contentHash });
    changed.add(path);
  }

  const removed = [...gone].filter((path) => indexed.has(path));
  yield* store.remove(vault.id, removed);
  for (const path of removed) changed.add(path);

  if (changed.size > 0) {
    const linkIndex = makeLinkIndex((yield* store.files(vault.id)).map((file) => file.path));
    const updates = (yield* store.links(vault.id)).flatMap((link) => {
      const targetPath = (link.kind === "markdown" ? resolveMarkdownTarget : resolveLinkTarget)(linkIndex, link.target, link.srcPath) ?? null;
      return targetPath === link.targetPath ? [] : [{ ...link, targetPath }];
    });
    yield* store.setLinkTargets(vault.id, updates);
  }
  return [...changed].sort();
});
