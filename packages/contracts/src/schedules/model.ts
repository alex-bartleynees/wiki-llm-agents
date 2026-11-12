import { Schema } from "effect";

/**
 * Reminders and scheduled prompts. A schedule's times are local times in an IANA
 * timezone ("09:00 every day in Pacific/Auckland"), never UTC offsets, so they stay
 * at 09:00 across daylight saving.
 */

/** `HH:MM`, 24-hour. */
export const LocalTime = Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/)).annotate({
  description: "A local time, HH:MM in 24-hour time, e.g. 09:00.",
});

/** `YYYY-MM-DD`. */
export const LocalDate = Schema.String.check(Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)).annotate({
  description: "A local date, YYYY-MM-DD.",
});

/** ISO weekday: 1 is Monday, 7 is Sunday. */
export const Weekday = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 7 }));

export const Once = Schema.TaggedStruct("once", { date: LocalDate, time: LocalTime });
export const Daily = Schema.TaggedStruct("daily", { time: LocalTime });
export const Weekly = Schema.TaggedStruct("weekly", {
  days: Schema.Array(Weekday).check(Schema.isMinLength(1), Schema.isUnique()),
  time: LocalTime,
});

/**
 * When a schedule fires. A time that doesn't exist on a day (the hour skipped when
 * daylight saving starts) fires that much later (02:30 becomes 03:30); a time that
 * happens twice (when it ends) fires once, the first time.
 */
export const Recurrence = Schema.Union([Once, Daily, Weekly]);
export type Recurrence = typeof Recurrence.Type;

/**
 * - `reminder`: a message at a time; no model runs, so it can't fail.
 * - `prompt`: an agent's turn at a time; its answer is what arrives.
 */
export const ScheduleKind = Schema.Literals(["reminder", "prompt"]);
export type ScheduleKind = typeof ScheduleKind.Type;

/**
 * What a scheduled prompt does with a time missed while the app was off (several
 * missed times count as one):
 * - `same-day`: run it once if it is still the same local day, otherwise record it as missed
 * - `always`: run it once, however late
 * - `skip`: record it as missed
 *
 * Reminders are always delivered once, marked overdue.
 */
export const MissedPolicy = Schema.Literals(["same-day", "always", "skip"]);
export type MissedPolicy = typeof MissedPolicy.Type;

/** What a reminder links to. */
export const ScheduleLink = Schema.Union([
  Schema.TaggedStruct("note", { vaultId: Schema.String, path: Schema.String.check(Schema.isNonEmpty()) }),
  Schema.TaggedStruct("thread", { threadId: Schema.String }),
]);
export type ScheduleLink = typeof ScheduleLink.Type;

/**
 * - `active`: fires at `nextAt`
 * - `paused`: by you, or by itself after three failed runs in a row (`pausedReason`)
 * - `finished`: a one-off that has fired
 */
export const ScheduleStatus = Schema.Literals(["active", "paused", "finished"]);
export type ScheduleStatus = typeof ScheduleStatus.Type;

/**
 * - `delivered`: a reminder arrived in the inbox
 * - `running`, `completed`, `failed`: a scheduled prompt's turn
 * - `missed`: the app was off at the time, and the missed policy said not to run it
 * - `skipped`: the previous run was still going (or you were using its thread)
 */
export const RunStatus = Schema.Literals(["delivered", "running", "completed", "failed", "missed", "skipped"]);
export type RunStatus = typeof RunStatus.Type;

/** One time a schedule fired (or should have). */
export const ScheduleRun = Schema.Struct({
  id: Schema.String,
  scheduleId: Schema.String,
  /** The time it was due, milliseconds since the epoch. */
  slotAt: Schema.Number,
  /** When it actually fired. */
  firedAt: Schema.Number,
  status: RunStatus,
  /** Fired late (the app was off or asleep at the time). */
  overdue: Schema.Boolean,
  /** Earlier missed times folded into this one. */
  coalesced: Schema.Number,
  /** Started with Run now. */
  manual: Schema.Boolean,
  /** The scheduled prompt's turn. */
  threadId: Schema.NullOr(Schema.String),
  turnId: Schema.NullOr(Schema.String),
  /** Why it failed, was skipped or missed. */
  reason: Schema.NullOr(Schema.String),
  inputTokens: Schema.NullOr(Schema.Number),
  outputTokens: Schema.NullOr(Schema.Number),
  costUsd: Schema.NullOr(Schema.Number),
  endedAt: Schema.NullOr(Schema.Number),
});
export type ScheduleRun = typeof ScheduleRun.Type;

/** What you choose when creating or editing a schedule. */
export const ScheduleFields = Schema.Struct({
  kind: ScheduleKind,
  /** Shown in lists and the inbox; defaults to the text's first line. */
  title: Schema.String,
  /** The reminder's message, or the prompt the agent is given. */
  text: Schema.String.check(Schema.isNonEmpty()),
  recurrence: Recurrence,
  /** IANA timezone, e.g. Pacific/Auckland. */
  timezone: Schema.String.check(Schema.isNonEmpty()),
  /** A scheduled prompt's vault (its thread runs there); for a reminder, the vault it came from. */
  vaultId: Schema.NullOr(Schema.String),
  /** A scheduled prompt's project, if its thread runs in one. */
  projectId: Schema.NullOr(Schema.String),
  /** A scheduled prompt's agent; null for the rules alone. */
  agentId: Schema.NullOr(Schema.String),
  /** A scheduled prompt's provider and model; null for the agent's (or the default). */
  providerInstanceId: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  /** A reminder's note or thread. */
  link: Schema.NullOr(ScheduleLink),
  missed: MissedPolicy,
});
export type ScheduleFields = typeof ScheduleFields.Type;

export const Schedule = Schema.Struct({
  ...ScheduleFields.fields,
  id: Schema.String,
  /** A scheduled prompt's own thread: each run is one turn in it. */
  threadId: Schema.NullOr(Schema.String),
  status: ScheduleStatus,
  /** Why it paused itself; null when you paused it, or it isn't paused. */
  pausedReason: Schema.NullOr(Schema.String),
  /** When it fires next, milliseconds since the epoch; null unless active. */
  nextAt: Schema.NullOr(Schema.Number),
  /** `nextAt` as a concrete local date, time and timezone, e.g. "Thu 13 Nov 2026, 09:00 NZDT (Pacific/Auckland)". */
  nextLabel: Schema.NullOr(Schema.String),
  /** The recurrence in words, e.g. "Every day at 09:00". */
  recurrenceLabel: Schema.String,
  /** The latest runs, newest first. */
  runs: Schema.Array(ScheduleRun),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type Schedule = typeof Schedule.Type;

/** Where schedules are listed and edited in the app; `?edit=<id>` opens one. */
export const SCHEDULES_PATH = "/inbox/schedules";
export const scheduleHref = (scheduleId: string) => `${SCHEDULES_PATH}?edit=${encodeURIComponent(scheduleId)}`;
