import { randomUUID } from "node:crypto";
import type { ScheduleRun } from "@wiki-agents/contracts/schedules/model";
import type { TurnUsage } from "@wiki-agents/contracts/threads/model";
import { Effect, Option } from "effect";
import { WallClock } from "../../shared/wall-clock.js";
import { Inbox } from "../inbox/inbox.js";
import type { NewInboxItem } from "../inbox/repository.js";
import { finalReply, turnNotices } from "../threads/final-reply.js";
import { ThreadRepository } from "../threads/repository.js";
import { ThreadActors } from "../threads/thread-actors.js";
import { describeInstant, latestDue, localDate, nextSlot } from "../../shared/time/recurrence.js";
import { type Occurrence, ScheduleRepository, type StoredSchedule } from "./repository.js";
import { SchedulerSignal } from "./signal.js";

/** Fired more than this after its time, an occurrence counts as late (the app was off or asleep). */
export const GRACE_MS = 60_000;

/** Failed runs in a row that pause a schedule. */
export const FAILURES_TO_PAUSE = 3;

export const NOT_STARTED = "The server stopped before the run started.";
export const THREAD_BUSY = "Its thread was busy with another turn.";
export const STILL_RUNNING = "The previous run was still going.";

type Base = Omit<Occurrence, "status" | "threadId" | "turnId" | "reason" | "item">;

const reminderItem = (schedule: StoredSchedule, overdue: boolean): NewInboxItem => {
  const link = schedule.link;
  return {
    kind: "reminder",
    title: schedule.title,
    body: schedule.text,
    overdue,
    source: {
      scheduleId: schedule.id,
      vaultId: link?._tag === "note" ? link.vaultId : schedule.vaultId,
      notePath: link?._tag === "note" ? link.path : null,
      threadId: link?._tag === "thread" ? link.threadId : null,
    },
  };
};

/**
 * Starts a scheduled prompt's run: records it as running (with its turn id) before
 * sending the prompt, unattended, to the schedule's thread. A run already going, or
 * someone using the thread, skips this occurrence; anything else fails the run.
 * None when the slot was already recorded.
 */
export const startRun = Effect.fnUntraced(function* (schedule: StoredSchedule, base: Base) {
  const repository = yield* ScheduleRepository;
  const inbox = yield* Inbox;
  if (Option.isSome(yield* repository.runningRun(schedule.id))) {
    return yield* repository.recordOccurrence(
      { ...base, status: "skipped", threadId: schedule.threadId, turnId: null, reason: STILL_RUNNING, item: null },
      inbox.channels,
    );
  }
  const turnId = randomUUID();
  const run = yield* repository.recordOccurrence(
    { ...base, status: "running", threadId: schedule.threadId, turnId, reason: null, item: null },
    inbox.channels,
  );
  if (Option.isNone(run)) return run;
  if (schedule.threadId === null) {
    yield* endRun(run.value, { status: "failed", reason: "The schedule has no thread to run in.", usage: null });
    return run;
  }
  const sent = yield* Effect.result((yield* ThreadActors).sendMessage(schedule.threadId, schedule.text, [], { unattended: true, turnId }));
  if (sent._tag === "Failure") {
    const error = sent.failure;
    if (error._tag === "ThreadBusy") yield* endRun(run.value, { status: "skipped", reason: THREAD_BUSY, usage: null });
    else yield* endRun(run.value, { status: "failed", reason: "message" in error ? String(error.message) : describeStartError(error), usage: null });
  }
  return run;
});

const describeStartError = (error: { readonly _tag: string }) => {
  switch (error._tag) {
    case "ThreadNotFound":
      return "The schedule's thread is gone.";
    case "VaultNotFound":
      return "The schedule's vault is gone.";
    case "ProviderInstanceNotFound":
      return "The schedule's provider isn't available.";
    default:
      return `The run couldn't start (${error._tag}).`;
  }
};

/**
 * Ends a run and puts its result in the inbox, in one transaction: the agent's
 * answer, or why it failed. The third failure in a row pauses the schedule and says
 * so. A run that has already ended is left alone, so this is safe to repeat.
 */
export const endRun = Effect.fnUntraced(function* (
  run: ScheduleRun,
  outcome: { readonly status: "completed" | "failed" | "skipped"; readonly reason: string | null; readonly usage: TurnUsage | null },
) {
  const repository = yield* ScheduleRepository;
  const inbox = yield* Inbox;
  const endedAt = yield* (yield* WallClock).now;
  const schedule = Option.getOrUndefined(yield* repository.find(run.scheduleId));
  const source = { scheduleId: run.scheduleId, threadId: run.threadId, turnId: run.turnId, vaultId: schedule?.vaultId ?? null };
  const title = schedule?.title ?? "Scheduled prompt";
  let item: NewInboxItem | null = null;
  let pause: string | null = null;
  if (outcome.status === "completed") {
    const events = run.threadId === null || run.turnId === null ? [] : (yield* (yield* ThreadRepository).events(run.threadId, 0)).map((stored) => stored.event);
    const reply = run.turnId === null ? "" : finalReply(events, run.turnId);
    const notices = run.turnId === null ? [] : turnNotices(events, run.turnId);
    const body = [
      reply === "" ? "_The agent finished without an answer._" : reply,
      ...(notices.length === 0 ? [] : ["", "**What it couldn't do unattended:**", ...notices.map((notice) => `- ${notice}`)]),
    ].join("\n");
    item = { kind: "prompt.result", title, body, overdue: run.overdue, source };
  } else if (outcome.status === "failed") {
    const failures = (yield* repository.failuresInARow(run.scheduleId)) + 1;
    const reason = outcome.reason ?? "The run failed.";
    if (schedule !== undefined && schedule.status === "active" && failures >= FAILURES_TO_PAUSE) {
      pause = `Paused after ${failures} failed runs in a row. The last: ${reason}`;
    }
    item = {
      kind: "prompt.failed",
      title: pause === null ? `Failed: ${title}` : `Paused: ${title}`,
      body: pause === null ? `${reason}\n\nIt won't be run again automatically; use Run now to try again.` : `${pause}\n\nFix it, then resume it.`,
      source,
    };
  }
  const ended = yield* repository.finishRun(
    run.id,
    { status: outcome.status, reason: outcome.reason, usage: outcome.usage, endedAt, item: schedule === undefined ? null : item, pause },
    inbox.channels,
  );
  if (ended) {
    yield* inbox.wake;
    if (pause !== null) yield* (yield* SchedulerSignal).wake;
  }
});

/**
 * Fires a due schedule. Times missed while the app was off fold into one occurrence
 * (the latest). A reminder is delivered, marked overdue if late. A late scheduled
 * prompt follows its missed policy: run it, or record it as missed in the inbox.
 * The schedule moves to its next time in the same transaction.
 */
export const fire = Effect.fnUntraced(function* (schedule: StoredSchedule, now: number) {
  if (schedule.nextAt === null) return;
  const repository = yield* ScheduleRepository;
  const inbox = yield* Inbox;
  const { latest, coalesced } = latestDue(schedule.recurrence, schedule.timezone, schedule.nextAt, now);
  const late = now - latest > GRACE_MS;
  const next = nextSlot(schedule.recurrence, schedule.timezone, now);
  const base: Base = {
    scheduleId: schedule.id,
    slotAt: latest,
    firedAt: now,
    overdue: late,
    coalesced,
    manual: false,
    advance: next === null ? { status: "finished", nextAt: null } : { status: "active", nextAt: next },
  };
  if (schedule.kind === "reminder") {
    yield* repository.recordOccurrence(
      { ...base, status: "delivered", threadId: null, turnId: null, reason: null, item: reminderItem(schedule, late) },
      inbox.channels,
    );
    return yield* inbox.wake;
  }
  const run =
    !late ||
    schedule.missed === "always" ||
    (schedule.missed === "same-day" && localDate(latest, schedule.timezone) === localDate(now, schedule.timezone));
  if (run) return yield* startRun(schedule, base);
  const when = describeInstant(latest, schedule.timezone);
  const reason = `The app was off at ${when}${coalesced > 0 ? ` (and ${coalesced} earlier time${coalesced === 1 ? "" : "s"})` : ""}.`;
  yield* repository.recordOccurrence(
    {
      ...base,
      status: "missed",
      threadId: schedule.threadId,
      turnId: null,
      reason,
      item: {
        kind: "prompt.missed",
        title: `Missed: ${schedule.title}`,
        body: `${reason} It didn't run; use Run now to run it.`,
        overdue: true,
        source: { scheduleId: schedule.id, threadId: schedule.threadId, vaultId: schedule.vaultId },
      },
    },
    inbox.channels,
  );
  yield* inbox.wake;
});

/** Run now: a new occurrence at this moment, by hand; the schedule's next time stays. */
export const runNow = Effect.fnUntraced(function* (schedule: StoredSchedule, now: number) {
  const base: Base = { scheduleId: schedule.id, slotAt: now, firedAt: now, overdue: false, coalesced: 0, manual: true, advance: null };
  if (schedule.kind === "prompt") return yield* startRun(schedule, base);
  const inbox = yield* Inbox;
  const run = yield* (yield* ScheduleRepository).recordOccurrence(
    { ...base, status: "delivered", threadId: null, turnId: null, reason: null, item: reminderItem(schedule, false) },
    inbox.channels,
  );
  yield* inbox.wake;
  return run;
});
