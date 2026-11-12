import { Effect, Option, Schema } from "effect";
import { Tool } from "effect/ai";
import { createSchedule } from "../../../schedules/create-schedule/use-case.js";
import { ThreadRepository } from "../../../threads/repository.js";
import { VaultCaller } from "../../auth.js";
import {
  DateParam,
  Days,
  MissedParam,
  Receipt,
  receiptOf,
  recordReceipt,
  Repeat,
  scheduleFailure,
  scheduleTool,
  Time,
  Timezone,
  toRecurrence,
} from "../schedule-shared.js";
import { ToolFailure, VaultPath, vaultPath } from "../shared.js";

export const ScheduleCreate = scheduleTool(
  Tool.make("schedule_create", {
    description: [
      "Schedules a reminder (a message for the user at a time) or a scheduled prompt (you, or another agent, are given the prompt at a time and the final answer goes to the user's inbox).",
      "Times are local times in an IANA timezone; the receipt shows the next date, time and timezone; tell the user.",
      "Before scheduling, ask the user about a time that is genuinely ambiguous (\"in the morning\", \"next Friday\" near a weekend, a date without a time); don't guess.",
      "A scheduled prompt runs unattended: anything that would ask the user is denied, so write a prompt that can be done without approvals.",
    ].join(" "),
    parameters: Schema.Struct({
      kind: Schema.Literals(["reminder", "prompt"]),
      text: Schema.String.check(Schema.isNonEmpty()).annotate({ description: "The reminder's message, or the prompt to run." }),
      title: Schema.optionalKey(Schema.String.annotate({ description: "A short name; defaults to the text's first line." })),
      repeat: Repeat,
      time: Time,
      date: Schema.optionalKey(DateParam),
      days: Schema.optionalKey(Days),
      timezone: Schema.optionalKey(Timezone),
      agentId: Schema.optionalKey(Schema.String.annotate({ description: "Scheduled prompt only: the agent to run it; defaults to this thread's agent." })),
      providerInstanceId: Schema.optionalKey(Schema.String.annotate({ description: "Scheduled prompt only: defaults to the agent's provider." })),
      model: Schema.optionalKey(Schema.String.annotate({ description: "Scheduled prompt only: defaults to the agent's model." })),
      notePath: Schema.optionalKey(VaultPath.annotate({ description: "Reminder only: a note in this vault to link to." })),
      linkThisThread: Schema.optionalKey(Schema.Boolean.annotate({ description: "Reminder only: link back to this conversation." })),
      missed: Schema.optionalKey(MissedParam),
    }),
    success: Receipt,
    failure: ToolFailure,
    dependencies: [VaultCaller],
  }),
);

export const scheduleCreate = Effect.fnUntraced(
  function* (params: typeof ScheduleCreate.parametersSchema.Type) {
    const { vaultId, threadId } = yield* VaultCaller;
    const recurrence = yield* toRecurrence(params);
    if (recurrence === undefined) return yield* new ToolFailure({ message: "Give repeat and time." });
    const thread = Option.getOrUndefined(yield* (yield* ThreadRepository).find(threadId));
    const prompt = params.kind === "prompt";
    const notePath = params.notePath === undefined ? undefined : yield* vaultPath(params.notePath);
    const schedule = yield* createSchedule({
      kind: params.kind,
      text: params.text,
      recurrence,
      vaultId,
      ...(params.title === undefined ? {} : { title: params.title }),
      ...(params.timezone === undefined ? {} : { timezone: params.timezone }),
      ...(params.missed === undefined ? {} : { missed: params.missed }),
      ...(prompt
        ? {
            projectId: thread?.projectId ?? null,
            agentId: params.agentId ?? thread?.agentId ?? null,
            providerInstanceId: params.providerInstanceId ?? null,
            model: params.model ?? null,
          }
        : {
            link:
              notePath !== undefined ? { _tag: "note" as const, vaultId, path: notePath } : params.linkThisThread === true ? { _tag: "thread" as const, threadId } : null,
          }),
    });
    const notices = prompt && (params.notePath !== undefined || params.linkThisThread !== undefined) ? ["Links are for reminders; a scheduled prompt's result links to its run."] : [];
    const receipt = yield* receiptOf(schedule, notices);
    yield* recordReceipt(threadId, receipt, "created");
    return receipt;
  },
  Effect.catch((error) => Effect.fail(scheduleFailure(error))),
);
