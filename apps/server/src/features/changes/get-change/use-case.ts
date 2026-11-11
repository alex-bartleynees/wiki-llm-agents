import type { GetChangeResponse } from "@wiki-agents/contracts/changes/get-change/response";
import { Effect } from "effect";
import { VaultIndex } from "../../indexing/vault-index.js";
import { findChange } from "../find-change.js";
import { changeKind } from "../turn-changes.js";

/** One change in full: before, after and what is on disk now. */
export const getChange = Effect.fn("getChange")(function* (changeId: string) {
  const { record, current } = yield* findChange(changeId);
  const hashes = [record.beforeHash, record.afterHash].filter((hash): hash is string => hash !== null);
  const contents = yield* (yield* VaultIndex).blobs(hashes);
  const content = (hash: string | null) => (hash === null ? null : (contents.get(hash) ?? ""));
  return {
    id: record.id,
    vaultId: record.vaultId,
    threadId: record.threadId,
    turnId: record.turnId,
    path: record.path,
    change: changeKind(record),
    attribution: record.attribution,
    before: content(record.beforeHash),
    after: content(record.afterHash),
    current: current?.content ?? null,
    undoable: record.undoneAt === null && (current?.hash ?? null) === record.afterHash,
    undoneAt: record.undoneAt,
  } satisfies GetChangeResponse;
});
