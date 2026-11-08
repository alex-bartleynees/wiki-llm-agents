import type { Vault } from "@wiki-agents/contracts/vaults/model";
import { Context, type Effect } from "effect";
import type { DbError } from "../../shared/persistence/errors.js";

export interface VaultRepositoryService {
  readonly list: Effect.Effect<ReadonlyArray<Vault>, DbError>;
}

export class VaultRepository extends Context.Service<VaultRepository, VaultRepositoryService>()(
  "VaultRepository",
) {}
