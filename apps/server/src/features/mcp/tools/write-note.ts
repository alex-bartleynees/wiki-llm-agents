import { Effect } from "effect";
import type { AgentNoteWrite } from "../../notes/agent-write/use-case.js";
import { ThreadActors } from "../../threads/thread-actors.js";
import { VaultCaller } from "../auth.js";
import { requireInScope, usableScope } from "../scope.js";
import { ToolFailure, vaultPath } from "./shared.js";

export const writeVaultNote = Effect.fnUntraced(function* (input: AgentNoteWrite) {
  const caller = yield* VaultCaller;
  const path = yield* vaultPath(input.path);
  yield* requireInScope(yield* usableScope, path);
  const saved = yield* (yield* ThreadActors).writeNote(caller.threadId, { ...input, path });
  return { path: saved.path, hash: saved.hash, notices: [] };
}, Effect.catch((error) => Effect.fail(new ToolFailure({ message:
  error._tag === "ToolFailure" || error._tag === "AgentNoteWriteRefused" ? error.message :
  error._tag === "NoteChangedOnDisk" ? "The note changed or already exists. Nothing was overwritten. Read it again with vault_read_note before editing; choose an absent path to create." :
  error._tag === "NoTurnRunning" ? "Notes can only be written during a running turn." :
  error._tag === "InvalidVaultPath" ? "This is not a writable markdown note inside the vault. Check its path and symlinks." :
  `Could not write the note (${error._tag}). Read its current version before trying again.` }))));
