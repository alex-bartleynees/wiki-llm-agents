import { type Recurrence, type Schedule, scheduleHref } from "@wiki-agents/contracts/schedules/model";
import { Effect, Option, Schema } from "effect";
import { Tool } from "effect/ai";
import { AgentCatalog } from "../../agents/catalog.js";
import { ThreadActors } from "../../threads/thread-actors.js";
import type { ScheduleReceipt } from "../../threads/thread-actor.js";
import { Notices, ToolFailure, vaultTool } from "./shared.js";

/**
 * What the schedule tools share: flat parameters for times (easier for a model than
 * a nested union), the receipt they return and record in the conversation, and
 * their failures in words the agent can act on.
 */

/** Schedule tools change the app's schedules (not the vault), so they aren't read-only. */
export const scheduleTool = <T extends Tool.Any>(tool: T): T => vaultTool(tool).annotate(Tool.Readonly, false) as T;

const DAY_NAMES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export const Repeat = Schema.Literals(["once", "daily", "weekly"]).annotate({
  description: "once (needs date), daily, or weekly (needs days).",
});
export const Time = Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/)).annotate({
  description: "Local time, HH:MM in 24-hour time, e.g. 09:00.",
});
export const DateParam = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)).annotate({
  description: "Local date, YYYY-MM-DD; for repeat once.",
});
export const Days = Schema.Array(Schema.Literals(DAY_NAMES)).check(Schema.isMinLength(1)).annotate({
  description: "Days of the week for repeat weekly, e.g. [\"mon\", \"fri\"].",
});
export const Timezone = Schema.String.check(Schema.isNonEmpty()).annotate({
  description: "IANA timezone, e.g. Pacific/Auckland. Defaults to the app's (schedule_list shows it).",
});
export const ScheduleId = Schema.String.check(Schema.isNonEmpty()).annotate({ description: "The schedule's id, from schedule_list or a receipt." });
export const MissedParam = Schema.Literals(["same-day", "always", "skip"]).annotate({
  description:
    "Scheduled prompt only: what to do with a time missed while the app was off. same-day (default) runs it at startup if still the same local day; always runs it; skip records it as missed.",
});

/** The recurrence from flat parameters, filling gaps from `current` (an update that changes only the time, say). */
export const toRecurrence = (
  params: { readonly repeat?: string; readonly time?: string; readonly date?: string; readonly days?: ReadonlyArray<string> },
  current?: Recurrence,
): Effect.Effect<Recurrence | undefined, ToolFailure> => {
  if (params.repeat === undefined && params.time === undefined && params.date === undefined && params.days === undefined) {
    return Effect.succeed(undefined);
  }
  const repeat = params.repeat ?? current?._tag;
  const time = params.time ?? current?.time;
  if (repeat === undefined || time === undefined) return Effect.fail(new ToolFailure({ message: "Give repeat and time." }));
  switch (repeat) {
    case "once": {
      const date = params.date ?? (current?._tag === "once" ? current.date : undefined);
      return date === undefined
        ? Effect.fail(new ToolFailure({ message: "repeat once needs a date (YYYY-MM-DD)." }))
        : Effect.succeed({ _tag: "once", date, time });
    }
    case "daily":
      return Effect.succeed({ _tag: "daily", time });
    default: {
      const days = params.days?.map((day) => DAY_NAMES.indexOf(day as (typeof DAY_NAMES)[number]) + 1) ?? (current?._tag === "weekly" ? current.days : undefined);
      return days === undefined
        ? Effect.fail(new ToolFailure({ message: "repeat weekly needs days, e.g. [\"mon\", \"fri\"]." }))
        : Effect.succeed({ _tag: "weekly", days: [...new Set(days)].sort((a, b) => a - b), time });
    }
  }
};

export const Receipt = Schema.Struct({
  scheduleId: Schema.String,
  kind: Schema.Literals(["reminder", "prompt"]),
  status: Schema.Literals(["active", "paused", "finished"]),
  title: Schema.String,
  text: Schema.String,
  recurrence: Schema.String,
  next: Schema.NullOr(Schema.String).annotate({ description: "When it fires next, as a local date, time and timezone; null if it won't." }),
  timezone: Schema.String,
  agent: Schema.NullOr(Schema.String),
  destination: Schema.String,
  editUrl: Schema.String.annotate({ description: "Where the user can change it in the app." }),
  notices: Notices,
});
export type Receipt = typeof Receipt.Type;

const agentName = Effect.fnUntraced(function* (agentId: string | null) {
  if (agentId === null) return "No agent (the rules alone)";
  const agent = yield* Effect.option((yield* AgentCatalog).get(agentId));
  return Option.isSome(agent) ? agent.value.name : agentId;
});

/** The schedule as the agent and the conversation see it. */
export const receiptOf = Effect.fnUntraced(function* (schedule: Schedule, notices: ReadonlyArray<string> = []) {
  const receipt: Receipt = {
    scheduleId: schedule.id,
    kind: schedule.kind,
    status: schedule.status,
    title: schedule.title,
    text: schedule.text,
    recurrence: schedule.recurrenceLabel,
    next: schedule.nextLabel,
    timezone: schedule.timezone,
    agent: schedule.kind === "prompt" ? yield* agentName(schedule.agentId) : null,
    destination: "Inbox",
    editUrl: scheduleHref(schedule.id),
    notices: [...notices, ...(schedule.pausedReason === null ? [] : [schedule.pausedReason])],
  };
  return receipt;
});

/** Shows the receipt in the conversation, with an edit link; outside a turn there is nowhere to show it. */
export const recordReceipt = (threadId: string, receipt: Receipt, action: ScheduleReceipt["action"]) =>
  Effect.gen(function* () {
    yield* (yield* ThreadActors).scheduleSaved(threadId, {
      action,
      scheduleId: receipt.scheduleId,
      kind: receipt.kind,
      title: receipt.title,
      text: receipt.text,
      recurrence: receipt.recurrence,
      next: receipt.next,
      timezone: receipt.timezone,
      agent: receipt.agent,
      destination: receipt.destination,
      href: receipt.editUrl,
    });
  }).pipe(Effect.catch((error) => Effect.logWarning(`schedule ${receipt.scheduleId}: can't show the receipt`, error)));

/** A schedule use case's failure, in words the agent can act on. */
export const scheduleFailure = (error: { readonly _tag: string; readonly message?: string; readonly reason?: string }): ToolFailure => {
  switch (error._tag) {
    case "ToolFailure":
    case "InvalidSchedule":
    case "InvalidProject":
      return new ToolFailure({ message: error.message ?? "The schedule couldn't be saved." });
    case "ScheduleNotFound":
      return new ToolFailure({ message: "There is no such schedule; schedule_list lists them." });
    case "ScheduleBusy":
      return new ToolFailure({ message: "A run of this schedule is still going; wait for it to finish." });
    case "AgentNotFound":
      return new ToolFailure({ message: `${error.reason ?? "No such agent."} Leave agentId out to use this thread's agent.` });
    case "ProviderInstanceNotFound":
      return new ToolFailure({ message: "No such provider; leave providerInstanceId out to use the agent's." });
    case "ProviderError":
      return new ToolFailure({ message: `The provider refused: ${error.message ?? "unknown error"}.` });
    case "VaultNotFound":
      return new ToolFailure({ message: "This thread's vault is no longer registered." });
    case "ProjectNotFound":
      return new ToolFailure({ message: "This thread's project no longer exists." });
    default:
      return new ToolFailure({ message: "The schedules couldn't be read or saved just now." });
  }
};
