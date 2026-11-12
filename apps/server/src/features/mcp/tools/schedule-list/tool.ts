import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { listSchedules } from "../../../schedules/list-schedules/use-case.js";
import { Receipt, receiptOf, scheduleFailure } from "../schedule-shared.js";
import { ToolFailure, vaultTool } from "../shared.js";

const LastRun = Schema.Struct({
  status: Schema.String,
  /** ISO 8601. */
  at: Schema.String,
  reason: Schema.NullOr(Schema.String),
});

export const ScheduleList = vaultTool(
  Tool.make("schedule_list", {
    description: "Lists the user's reminders and scheduled prompts, with when each fires next and its last run.",
    success: Schema.Struct({
      defaultTimezone: Schema.String,
      schedules: Schema.Array(Schema.Struct({ ...Receipt.fields, lastRun: Schema.NullOr(LastRun) })),
    }),
    failure: ToolFailure,
  }),
);

export const scheduleList = Effect.fnUntraced(
  function* () {
    const { schedules, defaultTimezone } = yield* listSchedules();
    return {
      defaultTimezone,
      schedules: yield* Effect.forEach(schedules, (schedule) =>
        Effect.map(receiptOf(schedule), (receipt) => {
          const last = schedule.runs[0];
          return {
            ...receipt,
            lastRun: last === undefined ? null : { status: last.status, at: new Date(last.firedAt).toISOString(), reason: last.reason },
          };
        }),
      ),
    };
  },
  Effect.catch((error) => Effect.fail(scheduleFailure(error))),
);
