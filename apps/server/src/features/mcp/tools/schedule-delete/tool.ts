import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { deleteSchedule } from "../../../schedules/delete-schedule/use-case.js";
import { showSchedule } from "../../../schedules/find-schedule.js";
import { VaultCaller } from "../../auth.js";
import { Receipt, receiptOf, recordReceipt, ScheduleId, scheduleFailure, scheduleTool } from "../schedule-shared.js";
import { ToolFailure } from "../shared.js";

export const ScheduleDelete = scheduleTool(
  Tool.make("schedule_delete", {
    description: "Deletes a schedule and its run history (its inbox items and thread stay). Confirm with the user first unless they asked for it.",
    parameters: Schema.Struct({ scheduleId: ScheduleId }),
    success: Receipt,
    failure: ToolFailure,
    dependencies: [VaultCaller],
  }),
).annotate(Tool.Destructive, true);

export const scheduleDelete = Effect.fnUntraced(
  function* (params: typeof ScheduleDelete.parametersSchema.Type) {
    const { threadId } = yield* VaultCaller;
    const schedule = yield* showSchedule(params.scheduleId, 0);
    yield* deleteSchedule(params.scheduleId);
    const receipt = { ...(yield* receiptOf(schedule)), next: null };
    yield* recordReceipt(threadId, receipt, "deleted");
    return receipt;
  },
  Effect.catch((error) => Effect.fail(scheduleFailure(error))),
);
