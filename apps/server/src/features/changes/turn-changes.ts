import type { FileChange } from "@wiki-agents/contracts/changes/model";
import type { Vault } from "@wiki-agents/contracts/vaults/model";
import { Effect } from "effect";
import { Indexer } from "../indexing/indexer.js";
import { VaultIndex } from "../indexing/vault-index.js";
import type { ChangeRecord } from "./change-log.js";
import { ChangeTracker } from "./change-tracker.js";
import { boundedDiff } from "./diff.js";
import { editWarnings } from "./edit-warnings.js";

export const changeKind = (record: Pick<ChangeRecord, "beforeHash" | "afterHash">): FileChange["change"] =>
  record.beforeHash === null ? "create" : record.afterHash === null ? "delete" : "modify";

/** The turn's changes as its card shows them: bounded diffs and edit warnings from the stored versions. */
export const describeChanges = Effect.fnUntraced(function* (records: ReadonlyArray<ChangeRecord>) {
  const hashes = records.flatMap((record) => [record.beforeHash, record.afterHash].filter((hash): hash is string => hash !== null));
  const contents = yield* (yield* VaultIndex).blobs(hashes);
  const content = (hash: string | null) => (hash === null ? null : (contents.get(hash) ?? ""));
  return records.map((record): FileChange => {
    const before = content(record.beforeHash);
    const after = content(record.afterHash);
    return {
      id: record.id,
      path: record.path,
      change: changeKind(record),
      attribution: record.attribution,
      ...boundedDiff(before, after),
      warnings: editWarnings(record.path, before, after),
    };
  });
});

/**
 * Ends change recording for a turn: first indexes the vault as it is now, so writes
 * the watcher hasn't reported yet are counted, then returns what the turn changed.
 * A failed scan is logged; the changes seen so far still count.
 */
export const closeTurnChanges = Effect.fnUntraced(function* (vault: Vault, turnId: string) {
  yield* (yield* Indexer).run({ _tag: "Scan", vault }).pipe(Effect.catch((error) => Effect.logWarning(`scanning ${vault.name} after a turn failed`, error)));
  return yield* describeChanges(yield* (yield* ChangeTracker).end(turnId));
});
