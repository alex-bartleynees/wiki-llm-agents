import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { runScheduleNow } from "../../../schedules/run-schedule-now/use-case.js";
import { VaultCaller } from "../../auth.js";
import { Receipt, receiptOf, recordReceipt, ScheduleId, scheduleFailure, scheduleTool } from "../schedule-shared.js";
import { ToolFailure } from "../shared.js";

export const ScheduleRunNow = scheduleTool(
  Tool.make("schedule_run_now", {
    description: "Fires a schedule now, by hand: a reminder arrives, a scheduled prompt runs (its result goes to the inbox). Its regular times are unchanged.",
    parameters: Schema.Struct({ scheduleId: ScheduleId }),
    success: Receipt,
    failure: ToolFailure,
    dependencies: [VaultCaller],
  }),
);

export const scheduleRunNow = Effect.fnUntraced(
  function* (params: typeof ScheduleRunNow.parametersSchema.Type) {
    const { threadId } = yield* VaultCaller;
    const receipt = yield* receiptOf((yield* runScheduleNow(params.scheduleId)).schedule);
    yield* recordReceipt(threadId, receipt, "run");
    return receipt;
  },
  Effect.catch((error) => Effect.fail(scheduleFailure(error))),
);
