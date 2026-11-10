import type { Vault } from "@wiki-agents/contracts/vaults/model";
import { Context, type Effect, type Option } from "effect";
import type { DbError } from "../../shared/persistence/errors.js";

/**
 * Registered vaults. Other features (notes) look vaults up through this port, never
 * through the SQLite adapter.
 */
export interface VaultRepositoryService {
  readonly list: Effect.Effect<ReadonlyArray<Vault>, DbError>;
  /** The vault registered first: the shared vault that projects use (one shared vault for now). */
  readonly firstRegistered: Effect.Effect<Option.Option<Vault>, DbError>;
  readonly findById: (id: string) => Effect.Effect<Option.Option<Vault>, DbError>;
  readonly findByRootPath: (rootPath: string) => Effect.Effect<Option.Option<Vault>, DbError>;
  readonly insert: (vault: Vault & { readonly createdAt: Date }) => Effect.Effect<void, DbError>;
}

export class VaultRepository extends Context.Service<VaultRepository, VaultRepositoryService>()(
  "VaultRepository",
) {}
