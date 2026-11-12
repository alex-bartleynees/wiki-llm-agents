import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { resumeSchedule } from "../../../schedules/resume-schedule/use-case.js";
import { VaultCaller } from "../../auth.js";
import { Receipt, receiptOf, recordReceipt, ScheduleId, scheduleFailure, scheduleTool } from "../schedule-shared.js";
import { ToolFailure } from "../shared.js";

export const ScheduleResume = scheduleTool(
  Tool.make("schedule_resume", {
    description: "Resumes a paused schedule from its next time after now; times missed while paused don't run.",
    parameters: Schema.Struct({ scheduleId: ScheduleId }),
    success: Receipt,
    failure: ToolFailure,
    dependencies: [VaultCaller],
  }),
);

export const scheduleResume = Effect.fnUntraced(
  function* (params: typeof ScheduleResume.parametersSchema.Type) {
    const { threadId } = yield* VaultCaller;
    const receipt = yield* receiptOf(yield* resumeSchedule(params.scheduleId));
    yield* recordReceipt(threadId, receipt, "resumed");
    return receipt;
  },
  Effect.catch((error) => Effect.fail(scheduleFailure(error))),
);
