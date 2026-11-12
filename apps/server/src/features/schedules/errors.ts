import { Data } from "effect";

export class ScheduleNotFound extends Data.TaggedError("ScheduleNotFound")<{ readonly scheduleId: string }> {}

/** The schedule can't be saved as asked; `message` says why, for you or the agent. */
export class InvalidSchedule extends Data.TaggedError("InvalidSchedule")<{ readonly message: string }> {}

/** Run now while a run is still going: one run per schedule at a time. */
export class ScheduleBusy extends Data.TaggedError("ScheduleBusy")<{ readonly scheduleId: string }> {}
