import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { pauseSchedule } from "../../../schedules/pause-schedule/use-case.js";
import { VaultCaller } from "../../auth.js";
import { Receipt, receiptOf, recordReceipt, ScheduleId, scheduleFailure, scheduleTool } from "../schedule-shared.js";
import { ToolFailure } from "../shared.js";

export const SchedulePause = scheduleTool(
  Tool.make("schedule_pause", {
    description: "Pauses a schedule: it won't fire until resumed.",
    parameters: Schema.Struct({ scheduleId: ScheduleId }),
    success: Receipt,
    failure: ToolFailure,
    dependencies: [VaultCaller],
  }),
);

export const schedulePause = Effect.fnUntraced(
  function* (params: typeof SchedulePause.parametersSchema.Type) {
    const { threadId } = yield* VaultCaller;
    const receipt = yield* receiptOf(yield* pauseSchedule(params.scheduleId));
    yield* recordReceipt(threadId, receipt, "paused");
    return receipt;
  },
  Effect.catch((error) => Effect.fail(scheduleFailure(error))),
);
