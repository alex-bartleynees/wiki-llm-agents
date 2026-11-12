import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Reminders and scheduled prompts. Times are local times in `timezone`; `nextAt` is
 * the next occurrence as an instant, recomputed after each one and on every edit.
 */
export const schedules = sqliteTable(
  "schedules",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["reminder", "prompt"] }).notNull(),
    title: text("title").notNull(),
    /** The reminder's message, or the prompt. */
    text: text("text").notNull(),
    /** A `Recurrence` as JSON. */
    recurrence: text("recurrence").notNull(),
    timezone: text("timezone").notNull(),
    vaultId: text("vault_id"),
    projectId: text("project_id"),
    agentId: text("agent_id"),
    providerInstanceId: text("provider_instance_id"),
    model: text("model"),
    /** A `ScheduleLink` as JSON, or null. */
    link: text("link"),
    /** A scheduled prompt's own thread: each run is one turn in it. */
    threadId: text("thread_id"),
    missedPolicy: text("missed_policy", { enum: ["same-day", "always", "skip"] }).notNull(),
    status: text("status", { enum: ["active", "paused", "finished"] }).notNull(),
    pausedReason: text("paused_reason"),
    /** Null while paused or once finished. */
    nextAt: integer("next_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("schedules_next_idx").on(table.status, table.nextAt)],
);

/**
 * Each occurrence of a schedule. One row per slot, so an occurrence never fires twice;
 * a "Run now" has its own slot (the time it was asked for).
 */
export const scheduleRuns = sqliteTable(
  "schedule_runs",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id").notNull(),
    slotAt: integer("slot_at", { mode: "timestamp_ms" }).notNull(),
    firedAt: integer("fired_at", { mode: "timestamp_ms" }).notNull(),
    status: text("status", { enum: ["delivered", "running", "completed", "failed", "missed", "skipped"] }).notNull(),
    overdue: integer("overdue", { mode: "boolean" }).notNull(),
    /** How many earlier slots this one stands for (missed while the app was off). */
    coalesced: integer("coalesced").notNull(),
    manual: integer("manual", { mode: "boolean" }).notNull(),
    threadId: text("thread_id"),
    turnId: text("turn_id"),
    reason: text("reason"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: real("cost_usd"),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("schedule_runs_slot_idx").on(table.scheduleId, table.slotAt),
    index("schedule_runs_turn_idx").on(table.turnId),
    index("schedule_runs_status_idx").on(table.status),
  ],
);
