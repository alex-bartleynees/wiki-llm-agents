import { dirname } from "node:path";
import type { UndoChangeResponse } from "@wiki-agents/contracts/changes/undo-change/response";
import { Clock, Effect, FileSystem } from "effect";
import { Indexer } from "../../indexing/indexer.js";
import { VaultIndex } from "../../indexing/vault-index.js";
import { ThreadActors } from "../../threads/thread-actors.js";
import { ChangeLog } from "../change-log.js";
import { ChangeTracker } from "../change-tracker.js";
import { ChangeConflict, ChangeUndoneAlready } from "../errors.js";
import { findChange } from "../find-change.js";

/**
 * Puts the file back as it was before the turn, only if it is still what the turn
 * left (else `ChangeConflict`, and nothing is written): writes the old content, or
 * deletes a file the turn created. Then indexes it, marks the change undone, and adds
 * `change.undone` to the thread.
 */
export const undoChange = Effect.fn("undoChange")(function* (changeId: string) {
  const { record, vault, absolute, current } = yield* findChange(changeId);
  if (record.undoneAt !== null) return yield* new ChangeUndoneAlready({ changeId });
  if ((current?.hash ?? null) !== record.afterHash) return yield* new ChangeConflict({ changeId });

  const fs = yield* FileSystem.FileSystem;
  yield* (yield* ChangeTracker).expectWrite(vault.id, record.path, record.beforeHash);
  if (record.beforeHash === null) {
    yield* fs.remove(absolute);
  } else {
    const before = (yield* (yield* VaultIndex).blobs([record.beforeHash])).get(record.beforeHash);
    if (before === undefined) return yield* Effect.die(new Error(`the version before change ${changeId} is missing`));
    yield* fs.makeDirectory(dirname(absolute), { recursive: true });
    yield* fs.writeFileString(absolute, before);
  }
  yield* (yield* Indexer).run({ _tag: "Sync", vault, paths: [record.path] }).pipe(
    Effect.catch((error) => Effect.logWarning(`indexing ${record.path} after undo failed`, error)),
  );

  const undoneAt = yield* Clock.currentTimeMillis;
  yield* (yield* ChangeLog).markUndone(changeId, undoneAt);
  yield* (yield* ThreadActors).changeUndone(record.threadId, record.turnId, changeId).pipe(
    Effect.catch((error) => Effect.logWarning(`recording the undo in thread ${record.threadId} failed`, error)),
  );
  return { changeId, undoneAt } satisfies UndoChangeResponse;
});
