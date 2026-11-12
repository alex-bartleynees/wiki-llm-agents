import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";
import type { SaveNoteRequest } from "@wiki-agents/contracts/notes/save-note/request";
import type { SaveNoteResponse } from "@wiki-agents/contracts/notes/save-note/response";
import { Effect, FileSystem, Option } from "effect";
import { normaliseVaultPath, resolveNewInVault } from "../../../shared/vault/path-guard.js";
import { ChangeTracker } from "../../changes/change-tracker.js";
import { Indexer } from "../../indexing/indexer.js";
import { findVault } from "../../vaults/find-vault.js";
import { NoteChangedOnDisk } from "../errors.js";
import { readNoteSource, requireNotePath, sha256 } from "../note-source.js";

export interface SaveNoteInput extends SaveNoteRequest {
  readonly vaultId: string;
}

/**
 * Writes a note from the editor, only if the file is still the version the edit
 * started from (`baseHash`; null: it mustn't exist yet), else `NoteChangedOnDisk`
 * and nothing is written. The write is atomic (a hidden temporary file renamed over
 * the note, keeping its permissions), so the watcher, Syncthing and other editors
 * never see half a note. The change is the user's, so it isn't recorded against a
 * running turn. Then the note is indexed before answering, so links and search are
 * current when the editor shows the save.
 */
export const saveNote = Effect.fn("saveNote")(function* (request: SaveNoteInput) {
  const vault = yield* findVault(request.vaultId);
  yield* requireNotePath(request.path);
  const fs = yield* FileSystem.FileSystem;
  const existing = yield* readNoteSource(vault.rootPath, request.path).pipe(
    Effect.map(Option.some),
    Effect.catchTag("VaultFileNotFound", () => Effect.succeed(Option.none())),
  );
  if ((Option.getOrUndefined(existing)?.hash ?? null) !== request.baseHash) {
    return yield* new NoteChangedOnDisk({ path: request.path });
  }

  const bytes = new TextEncoder().encode(request.content);
  const hash = sha256(bytes);
  if (Option.isSome(existing) && existing.value.hash === hash) {
    return { path: existing.value.path, hash, modifiedAt: existing.value.modifiedAt } satisfies SaveNoteResponse;
  }

  const target: { readonly path: string; readonly absolute: string; readonly mode?: number } = Option.isSome(existing)
    ? existing.value
    : {
        // resolveNewInVault refuses anything normaliseVaultPath can't normalise.
        absolute: yield* resolveNewInVault(vault.rootPath, request.path),
        path: normaliseVaultPath(request.path) ?? request.path,
      };
  const { path } = target;
  yield* fs.makeDirectory(dirname(target.absolute), { recursive: true });
  const temporary = join(dirname(target.absolute), `.${basename(target.absolute)}.${randomBytes(6).toString("hex")}.tmp`);
  yield* (yield* ChangeTracker).expectWrite(vault.id, path, hash);
  yield* Effect.gen(function* () {
    yield* fs.writeFile(temporary, bytes);
    if (target.mode !== undefined) yield* fs.chmod(temporary, target.mode & 0o7777);
    yield* fs.rename(temporary, target.absolute);
  }).pipe(Effect.onError(() => fs.remove(temporary).pipe(Effect.ignore)));

  yield* (yield* Indexer).run({ _tag: "Sync", vault, paths: [path] }).pipe(
    Effect.catch((error) => Effect.logWarning(`indexing ${path} after saving it failed`, error)),
  );
  const saved = yield* readNoteSource(vault.rootPath, path);
  return { path: saved.path, hash: saved.hash, modifiedAt: saved.modifiedAt } satisfies SaveNoteResponse;
});
