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
    providerInstanceId: text("provider_instance_id").notNull(),
    model: text("model"),
    /** The named agent (`agents/<id>.md`) the thread follows; null for the rules alone. */
    agentId: text("agent_id"),
    /** The provider's own session id, for resuming (OpenCode session, Claude session). */
    nativeSessionId: text("native_session_id"),
    /** When you marked the thread done; cleared by its next message. */
    doneAt: integer("done_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("threads_vault_idx").on(table.vaultId, table.updatedAt)],
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
    /** The message that started the turn, so a restarted turn can be resumed. */
    input: text("input").notNull(),
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
  (table) => [index("turns_thread_idx").on(table.threadId, table.status)],
);

/** Approvals and questions; pending ones survive restarts and stay answerable. */
export const runtimeRequests = sqliteTable(
  "runtime_requests",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    turnId: text("turn_id").notNull(),
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
