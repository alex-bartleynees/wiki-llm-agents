import type { VaultChanged } from "@wiki-agents/contracts/indexing/event";
import type { Vault } from "@wiki-agents/contracts/vaults/model";
import { Context, Data, type Effect, type PubSub, type Scope } from "effect";

/**
 * What the indexer is asked to do. Every command reconciles the index with what is
 * on disk now, so commands can be merged and replayed safely.
 * - `Sync`: these vault-relative paths may have changed (from the watcher)
 * - `Scan`: compare the whole vault by size, mtime, and hash (startup, registration)
 * - `Rebuild`: drop the vault's index and scan from scratch
 */
export type IndexCommand =
  | { readonly _tag: "Sync"; readonly vault: Vault; readonly paths: ReadonlyArray<string> }
  | { readonly _tag: "Scan"; readonly vault: Vault }
  | { readonly _tag: "Rebuild"; readonly vault: Vault };

export class IndexFailed extends Data.TaggedError("IndexFailed")<{
  readonly vaultId: string;
  readonly cause: unknown;
}> {}

/**
 * The IndexerActor: one queue and one fiber, so changes are indexed in order and
 * never concurrently. Commands queued while it works are taken as one batch.
 */
export interface IndexerService {
  /** Queues a command and waits until it has been applied. */
  readonly run: (command: IndexCommand) => Effect.Effect<void, IndexFailed>;
  /** Queues a command without waiting (the watcher). */
  readonly enqueue: (command: IndexCommand) => Effect.Effect<void>;
  /** Changes applied from now on, for as long as the scope is open. */
  readonly subscribe: Effect.Effect<PubSub.Subscription<VaultChanged>, never, Scope.Scope>;
}

export class Indexer extends Context.Service<Indexer, IndexerService>()("Indexer") {}
