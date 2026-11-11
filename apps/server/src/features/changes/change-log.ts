import type { Attribution } from "@wiki-agents/contracts/changes/model";
import { Context, type Effect, type Option } from "effect";
import type { DbError } from "../../shared/persistence/errors.js";

/** A recorded change (see `table.ts`). */
export interface ChangeRecord {
  readonly id: string;
  readonly vaultId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly path: string;
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
  readonly attribution: Attribution;
  readonly actor: string;
  /** Milliseconds since the epoch. */
  readonly recordedAt: number;
  readonly undoneAt: number | null;
}

export interface RecordChange {
  readonly vaultId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly actor: string;
  readonly path: string;
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
  readonly attribution: Attribution;
  readonly at: number;
}

/** The record of vault changes made during turns. */
export interface ChangeLogService {
  /**
   * Adds a change to the turn's row for the path: a new row keeps `beforeHash`; an
   * existing one keeps its own and takes the new `afterHash`. A row back at its
   * `beforeHash` is removed (no net change). Agent attribution is never downgraded.
   */
  readonly record: (change: RecordChange) => Effect.Effect<void, DbError>;
  /** The provider reported writing these vault paths in the turn. */
  readonly markAgent: (turnId: string, paths: ReadonlyArray<string>) => Effect.Effect<void, DbError>;
  /** The turn's changes, by path. */
  readonly forTurn: (turnId: string) => Effect.Effect<ReadonlyArray<ChangeRecord>, DbError>;
  readonly find: (changeId: string) => Effect.Effect<Option.Option<ChangeRecord>, DbError>;
  readonly markUndone: (changeId: string, at: number) => Effect.Effect<void, DbError>;
  /** The newest agent change to the note that left it in place and isn't undone. */
  readonly lastAgentEdit: (
    vaultId: string,
    path: string,
  ) => Effect.Effect<Option.Option<{ readonly actor: string; readonly threadId: string; readonly at: number }>, DbError>;
}

export class ChangeLog extends Context.Service<ChangeLog, ChangeLogService>()("ChangeLog") {}
