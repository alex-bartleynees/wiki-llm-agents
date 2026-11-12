import { basename, extname, join } from "node:path";
import type { DeleteNoteRequest } from "@wiki-agents/contracts/notes/delete-note/request";
import type { DeleteNoteResponse } from "@wiki-agents/contracts/notes/delete-note/response";
import { Effect, FileSystem } from "effect";
import { InvalidVaultPath } from "../../../shared/vault/errors.js";
import { ChangeTracker } from "../../changes/change-tracker.js";
import { Indexer } from "../../indexing/indexer.js";
import { findVault } from "../../vaults/find-vault.js";
import { NoteChangedOnDisk } from "../errors.js";
import { readNoteSource, requireNotePath } from "../note-source.js";

/** Obsidian's own trash folder, hidden from the app (a dot-name) and from Obsidian's file list. */
export const TRASH_FOLDER = ".trash";

/** `Coffee.md`, then `Coffee 1.md`, `Coffee 2.md`… */
const candidate = (name: string, attempt: number) => {
  if (attempt === 0) return name;
  const extension = extname(name);
  return `${name.slice(0, -extension.length)} ${attempt}${extension}`;
};

/**
 * Moves a note to `.trash/` at the top of the vault, as Obsidian does, so it can be
 * got back; only if it is still the version the user saw (`hash`), else
 * `NoteChangedOnDisk` and nothing moves. The note is hard-linked to the first free
 * name in the trash (a link never replaces a file) and then removed. The deletion is
 * the user's, so it isn't recorded against a running turn; the index drops the note
 * before answering, so links to it show as unresolved straight away.
 */
export const deleteNote = Effect.fn("deleteNote")(function* (request: DeleteNoteRequest) {
  const vault = yield* findVault(request.vaultId);
  yield* requireNotePath(request.path);
  const note = yield* readNoteSource(vault.rootPath, request.path);
  if (note.hash !== request.hash) return yield* new NoteChangedOnDisk({ path: note.path });

  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.realPath(vault.rootPath);
  const trash = join(root, TRASH_FOLDER);
  yield* fs.makeDirectory(trash, { recursive: true });
  // A symlinked trash could point anywhere; only a real folder in the vault is used.
  const trashInfo = yield* fs.stat(trash);
  if (trashInfo.type !== "Directory" || (yield* fs.realPath(trash)) !== trash) {
    return yield* new InvalidVaultPath({ path: TRASH_FOLDER });
  }

  // The note's own path, not where a symlink points: removing it removes the note.
  const source = join(root, note.path);
  yield* (yield* ChangeTracker).expectWrite(vault.id, note.path, null);
  const name = basename(note.path);
  let trashPath: string | undefined;
  for (let attempt = 0; trashPath === undefined; attempt += 1) {
    const file = candidate(name, attempt);
    const linked = yield* fs.link(source, join(trash, file)).pipe(
      Effect.as(true),
      Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.succeed(false)),
    );
    if (linked) trashPath = `${TRASH_FOLDER}/${file}`;
  }
  yield* fs.remove(source);

  yield* (yield* Indexer).run({ _tag: "Sync", vault, paths: [note.path] }).pipe(
    Effect.catch((error) => Effect.logWarning(`indexing ${note.path} after deleting it failed`, error)),
  );
  return { path: note.path, trashPath } satisfies DeleteNoteResponse;
});
