import type { Backlink } from "@wiki-agents/contracts/notes/get-backlinks/response";
import { Context, type Effect } from "effect";
import type { DbError } from "../../shared/persistence/errors.js";
import type { IndexedFile } from "./store.js";

/**
 * Read side of the vault index: the port other features (notes, later search and
 * MCP) use instead of the SQLite adapter.
 */
export interface VaultIndexService {
  /** Every visible file in the vault, sorted by path. */
  readonly files: (vaultId: string) => Effect.Effect<ReadonlyArray<IndexedFile>, DbError>;
  /** Notes linking to or embedding `path`, sorted by title, without `path` itself. */
  readonly backlinks: (vaultId: string, path: string) => Effect.Effect<ReadonlyArray<Backlink>, DbError>;
  readonly counts: (vaultId: string) => Effect.Effect<{ readonly files: number; readonly notes: number }, DbError>;
}

export class VaultIndex extends Context.Service<VaultIndex, VaultIndexService>()("VaultIndex") {}
