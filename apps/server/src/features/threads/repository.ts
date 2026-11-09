import type { RequestPrompt, StoredThreadEvent, ThreadEvent, ThreadSummary } from "@wiki-agents/contracts/threads/model";
import { Context, type Effect, type Option } from "effect";
import type { DbError } from "../../shared/persistence/errors.js";

export interface NewThread {
  readonly id: string;
  readonly vaultId: string;
  readonly providerInstanceId: string;
  readonly createdAt: number;
}

export interface PendingRequest {
  readonly requestId: string;
  readonly turnId: string;
  readonly prompt: RequestPrompt;
}

/** What a ThreadActor needs to pick up where the last run left off. */
export interface ThreadRecovery {
  /** The running turn, if any; `dispatched` is false when its `turn.start` outbox row is still there. */
  readonly openTurn: Option.Option<{ readonly id: string; readonly input: string; readonly dispatched: boolean }>;
  readonly pendingRequests: ReadonlyArray<PendingRequest>;
}

export interface RequestRecord {
  readonly requestId: string;
  readonly status: "pending" | "answered" | "cancelled";
}

/**
 * Threads and their events. `append` writes events and the tables derived from them
 * (`turns`, `runtime_requests`) in one transaction, so they can't disagree.
 * One writer per thread (its ThreadActor), which keeps `seq` gapless.
 */
export interface ThreadRepositoryService {
  readonly insert: (thread: NewThread) => Effect.Effect<ThreadSummary, DbError>;
  readonly find: (threadId: string) => Effect.Effect<Option.Option<ThreadSummary>, DbError>;
  /** Most recently updated first. */
  readonly listByVault: (vaultId: string) => Effect.Effect<ReadonlyArray<ThreadSummary>, DbError>;
  /** Events with a seq greater than `afterSeq`, in order. */
  readonly events: (threadId: string, afterSeq: number) => Effect.Effect<ReadonlyArray<StoredThreadEvent>, DbError>;
  /**
   * Appends events in order. With `startTurn`, also records a `turn.start` outbox
   * row: the provider hasn't been asked to run the turn yet.
   */
  readonly append: (
    threadId: string,
    events: ReadonlyArray<ThreadEvent>,
    at: number,
    options?: { readonly startTurn?: string },
  ) => Effect.Effect<ReadonlyArray<StoredThreadEvent>, DbError>;
  /** The provider has the turn: drops its `turn.start` outbox row. */
  readonly markDispatched: (turnId: string) => Effect.Effect<void, DbError>;
  readonly recovery: (threadId: string) => Effect.Effect<ThreadRecovery, DbError>;
  readonly findRequest: (threadId: string, requestId: string) => Effect.Effect<Option.Option<RequestRecord>, DbError>;
  /** Threads with a turn still running, to wake at startup. */
  readonly withOpenTurns: Effect.Effect<ReadonlyArray<string>, DbError>;
}

export class ThreadRepository extends Context.Service<ThreadRepository, ThreadRepositoryService>()("ThreadRepository") {}
