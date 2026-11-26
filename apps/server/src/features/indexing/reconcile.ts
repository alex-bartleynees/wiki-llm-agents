import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileKind } from "@wiki-agents/contracts/notes/model";
import type { Vault } from "@wiki-agents/contracts/vaults/model";
import { Effect, FileSystem, Option } from "effect";
import { extractNote } from "../../shared/markdown/extract.js";
import { makeLinkIndex, resolveLinkTarget, resolveMarkdownTarget } from "../../shared/markdown/link-resolution.js";
import { normaliseVaultPath, resolveInVault } from "../../shared/vault/path-guard.js";
import { listVaultFiles } from "../../shared/vault/vault-files.js";
import { FileChangeSink } from "./change-sink.js";
import { type IndexedFile, type IndexedFileWithHash, IndexStore, type NoteToIndex } from "./store.js";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const utf8 = new TextDecoder();
const IO_CONCURRENCY = 16;

const resolveScope = Effect.fnUntraced(function* (vaultId: string, root: string, scope: "all" | ReadonlySet<string>) {
  const fs = yield* FileSystem.FileSystem;
  const store = yield* IndexStore;
  const loadFull = Effect.gen(function* () {
    const [existingFiles, diskFiles] = yield* Effect.all([store.files(vaultId), listVaultFiles(root)], { concurrency: 2 });
    const knownFiles = new Map<string, IndexedFileWithHash>(existingFiles.map((file) => [file.path, file]));
    const candidates = new Set(diskFiles);
    const gone = new Set([...knownFiles.keys()].filter((path) => !candidates.has(path)));
    return { full: true, knownFiles, candidates, gone };
  });

  if (scope === "all") return yield* loadFull;

  const scopedPaths: Array<string> = [];
  for (const raw of scope) {
    const path = normaliseVaultPath(raw);
    if (path !== undefined) scopedPaths.push(path);
  }
  const scopedChecks = yield* Effect.forEach(
    scopedPaths,
    (path) =>
      Effect.gen(function* () {
        const resolved = yield* resolveInVault(root, path).pipe(Effect.option);
        const info = Option.isSome(resolved) ? yield* fs.stat(resolved.value.absolute).pipe(Effect.option) : Option.none();
        return { path, info };
      }),
    { concurrency: IO_CONCURRENCY },
  );

  const candidates = new Set<string>();
  const gone = new Set<string>();
  let hadMissingScoped = false;
  for (const { path, info } of scopedChecks) {
    if (Option.isNone(info)) {
      hadMissingScoped = true;
      gone.add(path);
    } else if (info.value.type === "Directory") {
      return yield* loadFull;
    } else if (info.value.type === "File") {
      candidates.add(path);
    } else {
      gone.add(path);
    }
  }

  if (hadMissingScoped) {
    const knownFiles = new Map<string, IndexedFileWithHash>((yield* store.files(vaultId)).map((file) => [file.path, file]));
    for (const path of [...gone]) {
      for (const known of knownFiles.keys()) if (known.startsWith(`${path}/`)) gone.add(known);
    }
    return { full: false, knownFiles, candidates, gone };
  }

  const lookupPaths = [...candidates, ...gone];
  const knownFiles = new Map<string, IndexedFileWithHash>((yield* store.filesByPath(vaultId, lookupPaths)).map((file) => [file.path, file]));
  return { full: false, knownFiles, candidates, gone };
});

const inspectCandidates = Effect.fnUntraced(function* (
  root: string,
  candidates: ReadonlySet<string>,
  knownFiles: ReadonlyMap<string, IndexedFileWithHash>,
) {
  const fs = yield* FileSystem.FileSystem;
  return yield* Effect.forEach(
    [...candidates],
    (path) =>
      Effect.gen(function* () {
        const absolute = join(root, path);
        const info = yield* fs.stat(absolute).pipe(Effect.option);
        if (Option.isNone(info) || info.value.type !== "File") return { kind: "gone" as const, path };
        const file: IndexedFile = {
          path,
          kind: fileKind(path),
          mtimeMs: Option.match(info.value.mtime, { onNone: () => 0, onSome: (date) => date.getTime() }),
          size: Number(info.value.size),
        };
        const previous = knownFiles.get(path);
        if (previous !== undefined && previous.mtimeMs === file.mtimeMs && previous.size === file.size && previous.kind === file.kind) {
          return { kind: "unchanged" as const };
        }
        if (file.kind !== "note") {
          return { kind: "file" as const, file, added: previous === undefined };
        }
        const bytes = yield* fs.readFile(absolute).pipe(Effect.option);
        if (Option.isNone(bytes)) return { kind: "gone" as const, path };
        const contentHash = sha256(bytes.value);
        if (previous?.contentHash === contentHash) {
          // Touched but not changed (a save without edits, a sync): only the mtime moves.
          return { kind: "touch" as const, file };
        }
        const content = utf8.decode(bytes.value);
        return {
          kind: "note" as const,
          file,
          previousHash: previous?.contentHash ?? null,
          added: previous === undefined,
          note: { ...extractNote(content, path), content, contentHash } satisfies NoteToIndex,
        };
      }),
    { concurrency: IO_CONCURRENCY },
  );
});

const resolveLinkIndexFor = Effect.fnUntraced(function* (
  vaultId: string,
  options: {
    readonly full: boolean;
    readonly pathsChanged: boolean;
    readonly candidates: ReadonlySet<string>;
    readonly gone: ReadonlySet<string>;
    readonly filesToPut: ReadonlyArray<IndexedFile>;
    readonly rawNotesToPut: ReadonlyArray<{ readonly file: IndexedFile; readonly note: NoteToIndex }>;
    readonly removed: ReadonlyArray<string>;
  },
) {
  const store = yield* IndexStore;
  if (!options.pathsChanged) return yield* store.linkIndex(vaultId);
  if (options.full) return makeLinkIndex([...options.candidates].filter((path) => !options.gone.has(path)));
  const existing = yield* store.files(vaultId);
  const allPaths = new Set(existing.map((file) => file.path));
  for (const file of options.filesToPut) allPaths.add(file.path);
  for (const item of options.rawNotesToPut) allPaths.add(item.file.path);
  for (const path of options.removed) allPaths.delete(path);
  return makeLinkIndex([...allPaths]);
});

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
  const sink = yield* FileChangeSink;
  const root = yield* fs.realPath(vault.rootPath);
  const { full, knownFiles, candidates, gone } = yield* resolveScope(vault.id, root, scope);
  const inspections = yield* inspectCandidates(root, candidates, knownFiles);

  const changed = new Set<string>();
  const filesToPut: Array<IndexedFile> = [];
  const rawNotesToPut: Array<{ readonly file: IndexedFile; readonly note: NoteToIndex }> = [];
  let pathsChanged = false;

  for (const item of inspections) {
    if (item.kind === "unchanged") continue;
    if (item.kind === "gone") {
      gone.add(item.path);
      continue;
    }
    if (item.kind === "touch") {
      filesToPut.push(item.file);
      continue;
    }
    if (item.kind === "file") {
      filesToPut.push(item.file);
      changed.add(item.file.path);
      if (item.added) pathsChanged = true;
      continue;
    }
    // Before the index replaces the old version, so change review can keep it.
    yield* sink.noteChanged(vault.id, { path: item.file.path, beforeHash: item.previousHash, afterHash: item.note.contentHash });
    rawNotesToPut.push({ file: item.file, note: item.note });
    changed.add(item.file.path);
    if (item.added) pathsChanged = true;
  }

  const removed = [...gone].filter((path) => knownFiles.has(path));
  if (removed.length > 0) pathsChanged = true;

  const resolvedLinkIndex =
    rawNotesToPut.length > 0 || pathsChanged
      ? yield* resolveLinkIndexFor(vault.id, { full, pathsChanged, candidates, gone, filesToPut, rawNotesToPut, removed })
      : undefined;

  const notesToPut =
    resolvedLinkIndex === undefined
      ? rawNotesToPut
      : rawNotesToPut.map(({ file, note }) => ({
          file,
          note: {
            ...note,
            links: note.links.map((link) => ({
              ...link,
              targetPath: (link.kind === "markdown" ? resolveMarkdownTarget : resolveLinkTarget)(resolvedLinkIndex, link.target, file.path) ?? null,
            })),
          },
        }));

  yield* store.putBatch(vault.id, { files: filesToPut, notes: notesToPut, pathsChanged });

  for (const path of removed) {
    const beforeHash = knownFiles.get(path)?.contentHash ?? null;
    if (beforeHash !== null) yield* sink.noteChanged(vault.id, { path, beforeHash, afterHash: null });
  }
  yield* store.remove(vault.id, removed);
  for (const path of removed) changed.add(path);

  if (pathsChanged && resolvedLinkIndex !== undefined && !(full && knownFiles.size === 0)) {
    const freshlyIndexed = new Set(notesToPut.map((item) => item.file.path));
    const updates = (yield* store.links(vault.id)).flatMap((link) => {
      if (freshlyIndexed.has(link.srcPath)) return [];
      const targetPath = (link.kind === "markdown" ? resolveMarkdownTarget : resolveLinkTarget)(resolvedLinkIndex, link.target, link.srcPath) ?? null;
      return targetPath === link.targetPath ? [] : [{ ...link, targetPath }];
    });
    yield* store.setLinkTargets(vault.id, updates);
  }
  return [...changed].sort();
});
