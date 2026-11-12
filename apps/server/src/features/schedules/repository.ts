import type { RunStatus, Schedule, ScheduleRun, ScheduleStatus } from "@wiki-agents/contracts/schedules/model";
import type { TurnUsage } from "@wiki-agents/contracts/threads/model";
import { Context, type Effect, type Option } from "effect";
import type { DbError } from "../../shared/persistence/errors.js";
import type { NewInboxItem } from "../inbox/repository.js";

/** A schedule as stored: without its labels and runs, which are worked out when it is shown. */
export type StoredSchedule = Omit<Schedule, "nextLabel" | "recurrenceLabel" | "runs">;

/** Where the schedule goes next: a recurring one to its next slot, a one-off to finished. */
export interface Advance {
  readonly status: ScheduleStatus;
  readonly nextAt: number | null;
}

/** One occurrence to record, with its inbox item (if it has one) and the schedule's advance. */
export interface Occurrence {
  readonly scheduleId: string;
  readonly slotAt: number;
  readonly firedAt: number;
  readonly status: RunStatus;
  readonly overdue: boolean;
  readonly coalesced: number;
  readonly manual: boolean;
  readonly threadId: string | null;
  readonly turnId: string | null;
  readonly reason: string | null;
  readonly item: NewInboxItem | null;
  /** Null for Run now, which leaves the schedule's next time alone. */
  readonly advance: Advance | null;
}

/** How a scheduled prompt's run ended. */
export interface RunResult {
  readonly status: "completed" | "failed" | "skipped";
  readonly reason: string | null;
  readonly usage: TurnUsage | null;
  readonly endedAt: number;
  readonly item: NewInboxItem | null;
  /** Pause the schedule, saying why (three failed runs in a row). */
  readonly pause: string | null;
}

/**
 * Schedules and their runs. An occurrence, its inbox item and the schedule's next
 * time are written in one transaction, and each (schedule, slot) is recorded at most
 * once, so an occurrence never fires twice, even across restarts.
 */
export interface ScheduleRepositoryService {
  readonly insert: (schedule: StoredSchedule) => Effect.Effect<StoredSchedule, DbError>;
  readonly find: (scheduleId: string) => Effect.Effect<Option.Option<StoredSchedule>, DbError>;
  /** Newest first. */
  readonly list: Effect.Effect<ReadonlyArray<StoredSchedule>, DbError>;
  /** Saves the whole schedule as given. */
  readonly save: (schedule: StoredSchedule) => Effect.Effect<StoredSchedule, DbError>;
  /** Deletes the schedule and its runs; its inbox items and thread stay. */
  readonly remove: (scheduleId: string) => Effect.Effect<boolean, DbError>;
  /** Newest first, up to `limit` per schedule. */
  readonly runs: (scheduleIds: ReadonlyArray<string>, limit: number) => Effect.Effect<ReadonlyArray<ScheduleRun>, DbError>;
  /** Active schedules whose next time has come. */
  readonly due: (now: number) => Effect.Effect<ReadonlyArray<StoredSchedule>, DbError>;
  /** The earliest next time of any active schedule. */
  readonly nextDueAt: Effect.Effect<number | null, DbError>;
  /**
   * Records the occurrence; with an item, adds it and queues its deliveries. Returns
   * the run, or none when the slot was already recorded.
   */
  readonly recordOccurrence: (occurrence: Occurrence, channels: ReadonlyArray<string>) => Effect.Effect<Option.Option<ScheduleRun>, DbError>;
  readonly runningRun: (scheduleId: string) => Effect.Effect<Option.Option<ScheduleRun>, DbError>;
  readonly runningRuns: Effect.Effect<ReadonlyArray<ScheduleRun>, DbError>;
  readonly findRunByTurn: (turnId: string) => Effect.Effect<Option.Option<ScheduleRun>, DbError>;
  /**
   * Ends a running run with its result and inbox item, pausing the schedule if asked.
   * False when it had already ended, and nothing is written.
   */
  readonly finishRun: (runId: string, result: RunResult, channels: ReadonlyArray<string>) => Effect.Effect<boolean, DbError>;
  /** Failed runs since the last completed one. */
  readonly failuresInARow: (scheduleId: string) => Effect.Effect<number, DbError>;
}

export class ScheduleRepository extends Context.Service<ScheduleRepository, ScheduleRepositoryService>()("ScheduleRepository") {}
