import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** A conversation with an agent, scoped to the vault or a project. */
export const threads = sqliteTable(
  "threads",
  {
    id: text("id").primaryKey(),
    vaultId: text("vault_id").notNull(),
    /** Null for a vault thread. */
    projectId: text("project_id"),
    title: text("title"),
    draftText: text("draft_text").notNull().default(""),
    draftVersion: integer("draft_version").notNull().default(0),
    draftWriterId: text("draft_writer_id"),
    draftSequence: integer("draft_sequence").notNull().default(0),
    providerInstanceId: text("provider_instance_id").notNull(),
    model: text("model"),
    childModelSource: text("child_model_source", { enum: ["explicit", "agent-default", "provider-default", "inherited"] }),
    /** The named agent (`agents/<id>.md`) the thread follows; null for the rules alone. */
    agentId: text("agent_id"),
    /** The provider's own session id, for resuming (OpenCode session, Claude session). */
    nativeSessionId: text("native_session_id"),
    /** The thread this one continues (Continue in a new thread); null when it continues none. */
    continuedFromThreadId: text("continued_from_thread_id"),
    continuedInThreadId: text("continued_in_thread_id"),
    /** The manager that launched this child app thread. */
    parentThreadId: text("parent_thread_id"),
    /** When you marked the thread done; cleared by its next message. */
    doneAt: integer("done_at", { mode: "timestamp_ms" }),
    doneReason: text("done_reason", { enum: ["inactivity"] }),
    activityAt: integer("activity_at"),
    lastSeq: integer("last_seq").notNull().default(0),
    status: text("status", { enum: ["idle", "running", "waiting"] }).notNull().default("idle"),
    activeSubagents: integer("active_subagents").notNull().default(0),
    runningTurnJson: text("running_turn_json"),
    lastTurnJson: text("last_turn_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("threads_vault_idx").on(table.vaultId, table.updatedAt),
    index("threads_updated_idx").on(table.updatedAt),
    index("threads_active_idx").on(table.updatedAt).where(sql`${table.status} <> 'idle' OR ${table.activeSubagents} > 0`),
    index("threads_continued_from_idx").on(table.continuedFromThreadId),
    index("threads_parent_idx").on(table.parentThreadId),
    index("threads_inactivity_idx").on(table.activityAt, table.id).where(sql`${table.doneAt} IS NULL AND ${table.deletedAt} IS NULL`),
  ],
);

/**
 * Normalised events of each thread, in order: the record of the conversation.
 * `payload` is a `ThreadEvent` as JSON; `type` repeats its tag for queries.
 */
export const threadEvents = sqliteTable(
  "thread_events",
  {
    threadId: text("thread_id").notNull(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    payload: text("payload").notNull(),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.seq] })],
);

/** One message and the agent's work on it. `status` is running until the turn finishes. */
export const turns = sqliteTable(
  "turns",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    /** The message that started the turn, so a restarted turn can be resumed; empty for a compaction or a handoff. */
    input: text("input").notNull(),
    /**
     * `message`: you sent a message. `compaction`: you asked the provider to compact the
     * conversation; a restart never starts or continues one (it costs usage). `handoff`:
     * you asked the agent to write a handoff for a new thread; the same goes for it.
     * `subagent`: subagents reported and the provider started the turn by itself;
     * a restart never continues one either (the provider's session went with it).
     */
    kind: text("kind", { enum: ["message", "compaction", "handoff", "subagent"] }).notNull().default("message"),
    status: text("status", { enum: ["running", "completed", "interrupted", "failed"] }).notNull(),
    /** Sent by a schedule with nobody watching: requests are denied instead of waiting. */
    unattended: integer("unattended", { mode: "boolean" }).notNull().default(false),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: real("cost_usd"),
    /** Why it failed or stopped, from `turn.finished`; null when it completed or you pressed Stop. */
    reason: text("reason"),
    /** The latest `plan.updated` steps as JSON (`PlanStep[]`); null when the agent reported no plan. */
    plan: text("plan"),
  },
  (table) => [
    index("turns_thread_idx").on(table.threadId, table.status),
    index("turns_thread_ended_idx").on(table.threadId, table.endedAt),
  ],
);

/** Approvals and questions; pending ones survive restarts and stay answerable. */
export const runtimeRequests = sqliteTable(
  "runtime_requests",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    turnId: text("turn_id").notNull(),
    /** The subagent that asked (its provider id); null when the agent itself did. */
    subagentId: text("subagent_id"),
    /** A `RequestPrompt` as JSON. */
    prompt: text("prompt").notNull(),
    status: text("status", { enum: ["pending", "answered", "cancelled"] }).notNull(),
    /** A `RequestAnswer` as JSON, once answered. */
    answer: text("answer"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("runtime_requests_thread_idx").on(table.threadId, table.status)],
);

/**
 * Side effects recorded in the same transaction as the change that needs them, and
 * removed once done. `turn.start`: a turn was written but the provider hasn't been
 * asked to run it yet, so a restart starts it then. Sync rows join in M7.
 */
export const outbox = sqliteTable("outbox", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  payload: text("payload").notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }).notNull(),
});

/** Materialised note provenance, rebuilt from thread events if needed. */
export const threadNotes = sqliteTable("thread_notes", {
  threadId: text("thread_id").notNull(), turnId: text("turn_id").notNull(), path: text("path").notNull(),
  reason: text("reason").notNull(), hash: text("hash").notNull(),
}, (table) => [primaryKey({ columns: [table.threadId, table.turnId, table.path, table.reason, table.hash] }), index("thread_notes_path_idx").on(table.path)]);

/**
 * The subagents each thread's agent delegated to, as they are now: rebuilt from the
 * thread's `subagent.updated` events, kept here so a thread's running subagents can
 * be counted and closed after a restart.
 */
export const threadSubagents = sqliteTable(
  "thread_subagents",
  {
    threadId: text("thread_id").notNull(),
    /** The provider's id for the child. */
    subagentId: text("subagent_id").notNull(),
    /** The turn that launched it. */
    turnId: text("turn_id").notNull(),
    label: text("label").notNull(),
    agent: text("agent"),
    status: text("status", { enum: ["running", "waiting", "done", "failed", "cancelled", "interrupted"] }).notNull(),
    result: text("result"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.subagentId] }), index("thread_subagents_status_idx").on(table.status)],
);

export const threadInactivityPolicy = sqliteTable("thread_inactivity_policy", {
  id: integer("id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  days: integer("days").notNull(),
});
