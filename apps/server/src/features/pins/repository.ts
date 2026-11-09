import { Context, type Effect } from "effect";
import type { DbError } from "../../shared/persistence/errors.js";

export interface PinRepositoryService {
  /** Pinned paths in the order they were pinned. */
  readonly list: (vaultId: string) => Effect.Effect<ReadonlyArray<string>, DbError>;
  /** Pins the path; pinning it again keeps its place. */
  readonly add: (vaultId: string, path: string, pinnedAt: Date) => Effect.Effect<void, DbError>;
  readonly remove: (vaultId: string, path: string) => Effect.Effect<void, DbError>;
}

export class PinRepository extends Context.Service<PinRepository, PinRepositoryService>()("PinRepository") {}
