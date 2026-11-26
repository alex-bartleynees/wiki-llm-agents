import type { InactivityPolicy } from "@wiki-agents/contracts/threads/inactivity-policy";
import type { ThreadDraft } from "@wiki-agents/contracts/threads/draft";
import type { SaveDraftRequest } from "@wiki-agents/contracts/threads/save-draft/request";
import type { RequestPrompt, StoredThreadEvent, SubagentStatus, ThreadEvent, ThreadSummary, TurnOutcome } from "@wiki-agents/contracts/threads/model";
import { Context, type Effect, type Option } from "effect";
import type { DbError } from "../../shared/persistence/errors.js";

export interface NewThread {
  readonly id: string;
  readonly vaultId: string;
  /** Null for a vault thread. */
  readonly projectId: string | null;
  readonly providerInstanceId: string;
  readonly agentId: string | null;
  /** The model to start with; null for the provider's default. */
  readonly model: string | null;
  readonly childModelSource?: "explicit" | "agent-default" | "provider-default" | "inherited";
  /** Otherwise the first message names it. */
  readonly title?: string | undefined;
  /** The composer draft it starts with (a handoff); empty otherwise. */
  readonly draftText?: string | undefined;
  /** The thread it continues (Continue in a new thread). */
  readonly continuedFrom?: string | undefined;
  readonly parentThreadId?: string | undefined;
  readonly createdAt: number;
}

export interface PendingRequest {
  readonly requestId: string;
  readonly turnId: string;
  readonly prompt: RequestPrompt;
  /** A subagent asked (`turnId` launched it); it outlives that turn. */
  readonly subagentId?: string | undefined;
}

/** A subagent as last recorded (see `subagent.updated`). */
export interface SubagentRecord {
  readonly subagentId: string;
  readonly turnId: string;
  readonly label: string;
  readonly agent: string | null;
  readonly status: SubagentStatus;
  readonly result: string | null;
}

/** What a ThreadActor needs to pick up where the last run left off. */
export interface ThreadRecovery {
  /** The running turn, if any; `dispatched` is false when its `turn.start` outbox row is still there. */
  readonly openTurn: Option.Option<{
    readonly id: string;
    readonly input: string;
    readonly kind: TurnKind;
    readonly dispatched: boolean;
    readonly unattended: boolean;
  }>;
  readonly pendingRequests: ReadonlyArray<PendingRequest>;
  /** Subagents last recorded running or waiting. */
  readonly activeSubagents: ReadonlyArray<SubagentRecord>;
}

/** What started a turn: a message, a compaction or handoff you asked for, or subagents reporting. */
export type TurnKind = "message" | "compaction" | "handoff" | "subagent";

/** A turn as recorded: its outcome and usage once it has finished. */
export interface TurnRecord {
  readonly id: string;
  readonly threadId: string;
  readonly kind: TurnKind;
  readonly status: "running" | TurnOutcome;
  readonly unattended: boolean;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costUsd: number | null;
  readonly endedAt: number | null;
}

/** A request still waiting for an answer, in any thread. */
export interface OpenRequest extends PendingRequest {
  readonly threadId: string;
  readonly unattended: boolean;
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
  readonly draft: (threadId: string) => Effect.Effect<ThreadDraft, DbError>;
  /** Null means another writer changed the version; an older sequence from this writer is ignored. */
  readonly saveDraft: (threadId: string, request: SaveDraftRequest, at: number) => Effect.Effect<{ readonly draft: ThreadDraft; readonly reopened?: ThreadSummary } | null, DbError>;
  readonly noteContext: (vaultId: string, path?: string) => Effect.Effect<ReadonlyArray<import("@wiki-agents/contracts/threads/list-note-context/response").NoteContextLink>, DbError>;
  readonly insert: (thread: NewThread) => Effect.Effect<ThreadSummary, DbError>;
  readonly find: (threadId: string) => Effect.Effect<Option.Option<ThreadSummary>, DbError>;
  /** What the provider needs to continue the thread's conversation, and the agent it follows. */
  readonly providerSession: (
    threadId: string,
  ) => Effect.Effect<{ readonly nativeSessionId: string | null; readonly model: string | null; readonly agentId: string | null }, DbError>;
  readonly setNativeSession: (threadId: string, nativeSessionId: string | null) => Effect.Effect<void, DbError>;
  readonly setModel: (threadId: string, model: string, at: number) => Effect.Effect<ThreadSummary, DbError>;
  readonly setAgent: (threadId: string, agentId: string | null, at: number) => Effect.Effect<ThreadSummary, DbError>;
  readonly inactivityPolicy: Effect.Effect<InactivityPolicy, DbError>;
  readonly saveInactivityPolicy: (policy: InactivityPolicy) => Effect.Effect<void, DbError>;
  readonly inactivityPolicyChanged: Effect.Effect<void>;
  readonly inactiveCandidates: (cutoff: number, after?: { readonly at: number; readonly id: string }) => Effect.Effect<ReadonlyArray<{ readonly at: number; readonly id: string }>, DbError>;
  readonly completeInactive: (threadId: string, now: number) => Effect.Effect<ThreadSummary | undefined, DbError>;
  readonly setDone: (threadId: string, done: boolean, at: number) => Effect.Effect<{ readonly thread: ThreadSummary; readonly children: ReadonlyArray<ThreadSummary> } | undefined, DbError>;
  /**
   * Most recently updated first. With `scope`, only that project's threads (for a null
   * `projectId`, the vault's own threads); without, every thread in the vault.
   */
  readonly listByVault: (vaultId: string, scope?: { readonly projectId: string | null }) => Effect.Effect<ReadonlyArray<ThreadSummary>, DbError>;
  /**
   * In every vault, most recently updated first: threads updated since `since`, and
   * any with a turn still running (or a subagent at work) however long ago it started. The running view
   * picks from these with `threadActivity`.
   */
  readonly listActive: (since: number) => Effect.Effect<ReadonlyArray<ThreadSummary>, DbError>;
  readonly listChildren: (parentThreadId: string) => Effect.Effect<ReadonlyArray<ThreadSummary>, DbError>;
  /** Events with a seq greater than `afterSeq`, in order. */
  readonly events: (threadId: string, afterSeq: number) => Effect.Effect<ReadonlyArray<StoredThreadEvent>, DbError>;
  readonly eventsOfTypes: (
    threadId: string,
    types: ReadonlyArray<ThreadEvent["_tag"]>,
  ) => Effect.Effect<ReadonlyArray<StoredThreadEvent>, DbError>;
  /**
   * Appends events in order. With `startTurn`, also records a `turn.start` outbox
   * row: the provider hasn't been asked to run the turn yet.
   */
  readonly append: (
    threadId: string,
    events: ReadonlyArray<ThreadEvent>,
    at: number,
    options?: { readonly startTurn?: string },
  ) => Effect.Effect<{
    readonly stored: ReadonlyArray<StoredThreadEvent>;
    readonly reopenedManager: ThreadSummary | undefined;
  }, DbError>;
  /** The provider has the turn: drops its `turn.start` outbox row. */
  readonly markDispatched: (turnId: string) => Effect.Effect<void, DbError>;
  readonly recovery: (threadId: string) => Effect.Effect<ThreadRecovery, DbError>;
  readonly findRequest: (threadId: string, requestId: string) => Effect.Effect<Option.Option<RequestRecord>, DbError>;
  readonly findTurn: (turnId: string) => Effect.Effect<Option.Option<TurnRecord>, DbError>;
  /** Requests waiting for an answer across every thread, oldest first. */
  readonly openRequests: Effect.Effect<ReadonlyArray<OpenRequest>, DbError>;
  /** Managers with children, to recover report delivery at startup. */
  readonly withChildren: Effect.Effect<ReadonlyArray<string>, DbError>;
  /** Threads with a turn still running or a subagent still at work, to wake at startup. */
  readonly withOpenTurns: Effect.Effect<ReadonlyArray<string>, DbError>;
}

export class ThreadRepository extends Context.Service<ThreadRepository, ThreadRepositoryService>()("ThreadRepository") {}
