import type { ScheduleFields } from "@wiki-agents/contracts/schedules/model";
import { Effect } from "effect";
import { AgentCatalog } from "../agents/catalog.js";
import { createThread } from "../threads/create-thread/use-case.js";
import { ThreadActors } from "../threads/thread-actors.js";
import { findVault } from "../vaults/find-vault.js";
import { InvalidSchedule } from "./errors.js";
import { isTimeZone, nextSlot, zonedTime } from "./recurrence.js";
import type { StoredSchedule } from "./repository.js";

const TITLE_LENGTH = 80;

/** The text's first line, shortened. */
export const titleFrom = (text: string) => {
  const line = text.trim().split("\n")[0]!.trim();
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line;
};

/** Checks what was asked for, with messages written for you or the agent to act on. */
export const validateFields = Effect.fnUntraced(function* (fields: ScheduleFields) {
  if (fields.text.trim() === "") return yield* new InvalidSchedule({ message: "The schedule needs a message or prompt." });
  if (!isTimeZone(fields.timezone)) {
    return yield* new InvalidSchedule({ message: `Unknown timezone "${fields.timezone}"; use an IANA name such as Pacific/Auckland.` });
  }
  const { recurrence } = fields;
  if (recurrence._tag === "once" && zonedTime(recurrence.date, recurrence.time, fields.timezone) === null) {
    return yield* new InvalidSchedule({ message: `There is no ${recurrence.date}.` });
  }
  if (fields.kind === "prompt") {
    if (fields.vaultId === null) return yield* new InvalidSchedule({ message: "A scheduled prompt needs a vault to run in." });
    if (fields.link !== null) return yield* new InvalidSchedule({ message: "Only a reminder links to a note or thread." });
    if (fields.agentId !== null) yield* (yield* AgentCatalog).get(fields.agentId);
  } else if (fields.agentId !== null || fields.providerInstanceId !== null || fields.model !== null) {
    return yield* new InvalidSchedule({ message: "A reminder has no agent, provider or model; make it a scheduled prompt." });
  }
  if (fields.vaultId !== null) yield* findVault(fields.vaultId);
  if (fields.link?._tag === "note") yield* findVault(fields.link.vaultId);
});

/** The next time after `now`; refused when there is none (a one-off in the past). */
export const nextTime = Effect.fnUntraced(function* (fields: ScheduleFields, now: number) {
  const next = nextSlot(fields.recurrence, fields.timezone, now);
  if (next === null) return yield* new InvalidSchedule({ message: "That time has already passed; choose a time in the future." });
  return next;
});

/**
 * A scheduled prompt's thread: a new one, or `current`'s kept with its agent and
 * model brought up to date. A new vault, project or provider needs a new thread.
 */
export const promptThread = Effect.fnUntraced(function* (fields: ScheduleFields, current: StoredSchedule | null) {
  if (fields.kind !== "prompt" || fields.vaultId === null) return null;
  const actors = yield* ThreadActors;
  const reuse =
    current?.threadId != null &&
    current.vaultId === fields.vaultId &&
    current.projectId === fields.projectId &&
    current.providerInstanceId === fields.providerInstanceId;
  if (reuse) {
    if (current.agentId !== fields.agentId) yield* actors.setAgent(current.threadId!, fields.agentId);
    if (fields.model !== null && current.model !== fields.model) yield* actors.setModel(current.threadId!, fields.model);
    return current.threadId;
  }
  const { thread } = yield* createThread(
    {
      vaultId: fields.vaultId,
      ...(fields.projectId === null ? {} : { projectId: fields.projectId }),
      ...(fields.providerInstanceId === null ? {} : { providerInstanceId: fields.providerInstanceId }),
      ...(fields.agentId === null ? {} : { agentId: fields.agentId }),
    },
    { title: `Scheduled: ${fields.title}` },
  );
  if (fields.model !== null) yield* actors.setModel(thread.id, fields.model);
  return thread.id;
});
