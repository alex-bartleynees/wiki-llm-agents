import { Cause, Effect, Option, PubSub } from "effect";
import { WallClock } from "../../shared/wall-clock.js";
import { ThreadRepository } from "../threads/repository.js";
import { ThreadBus } from "../threads/thread-bus.js";
import { ScheduleRepository } from "./repository.js";
import { endRun, fire, NOT_STARTED } from "./runner.js";
import { SchedulerSignal } from "./signal.js";

/** How long the scheduler waits after its own failure (the database, say) before looking again. */
const ERROR_PAUSE = 5000;

/**
 * The scheduler: fires every schedule that is due, then sleeps until the next one is
 * (or until a schedule changes). Server-owned, on the app's clock; everything it
 * needs is in SQLite, so after a restart it catches up on what it missed.
 */
export const runScheduler = Effect.gen(function* () {
  const repository = yield* ScheduleRepository;
  const signal = yield* SchedulerSignal;
  const clock = yield* WallClock;

  const round = Effect.gen(function* () {
    const now = yield* clock.now;
    for (const schedule of yield* repository.due(now)) {
      yield* fire(schedule, now).pipe(Effect.catch((error) => Effect.logError(`schedule ${schedule.id}: can't fire`, error)));
    }
    const next = yield* repository.nextDueAt;
    yield* next === null ? signal.woken : Effect.raceFirst(signal.woken, clock.sleepUntil(next));
  });

  return yield* round.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.andThen(
            Effect.logError("scheduler failed", cause),
            Effect.raceFirst(signal.woken, Effect.flatMap(clock.now, (now) => clock.sleepUntil(now + ERROR_PAUSE))),
          ),
    ),
    Effect.forever,
  );
});

/**
 * Ends scheduled runs as their turns finish. Subscribes now, and returns the work to
 * run in the background: first runs left running by the last server (their turn
 * finished or never started), then each turn as it finishes.
 */
export const watchRuns = Effect.gen(function* () {
  const repository = yield* ScheduleRepository;
  const threads = yield* ThreadRepository;
  const subscription = yield* (yield* ThreadBus).subscribeEvents;

  const reconcile = Effect.gen(function* () {
    for (const run of yield* repository.runningRuns) {
      const turn = run.turnId === null ? Option.none() : yield* threads.findTurn(run.turnId);
      if (Option.isNone(turn)) {
        yield* endRun(run, { status: "failed", reason: NOT_STARTED, usage: null });
        continue;
      }
      const { status, inputTokens, outputTokens, costUsd } = turn.value;
      // Still running: its thread resumes it (or closes it) and the event ends the run.
      if (status === "running") continue;
      const usage = inputTokens === null || outputTokens === null ? null : { inputTokens, outputTokens, costUsd };
      yield* endRun(run, status === "completed" ? { status, reason: null, usage } : { status: "failed", reason: "The run stopped.", usage });
    }
  });

  const consume = PubSub.take(subscription).pipe(
    Effect.flatMap(({ event }) =>
      Effect.gen(function* () {
        if (event._tag !== "turn.finished") return;
        const run = yield* repository.findRunByTurn(event.turnId);
        if (Option.isNone(run) || run.value.status !== "running") return;
        yield* endRun(
          run.value,
          event.outcome === "completed"
            ? { status: "completed", reason: null, usage: event.usage }
            : { status: "failed", reason: event.reason ?? (event.outcome === "interrupted" ? "The run was stopped." : "The run failed."), usage: event.usage },
        );
      }).pipe(Effect.catch((error) => Effect.logError("schedules: can't end a run", error))),
    ),
    Effect.forever,
  );

  return Effect.andThen(reconcile.pipe(Effect.catch((error) => Effect.logError("schedules: can't reconcile runs", error))), consume);
});
