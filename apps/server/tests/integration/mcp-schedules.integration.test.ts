import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import { mcpSession, tokenFor } from "./infrastructure/mcp.js";
import { AKL, getSchedule } from "./infrastructure/schedules.js";
import { TestApp } from "./infrastructure/test-app.js";
import { getThread, isTag, newThread, newVault, sendOk, watch } from "./infrastructure/threads.js";

interface Receipt {
  readonly scheduleId: string;
  readonly kind: string;
  readonly status: string;
  readonly title: string;
  readonly recurrence: string;
  readonly next: string | null;
  readonly timezone: string;
  readonly agent: string | null;
  readonly destination: string;
  readonly editUrl: string;
}

/** A thread whose turn is waiting on an approval (so tool calls happen during it), and an MCP session for it. */
const duringATurn = Effect.gen(function* () {
  const vault = yield* newVault;
  const thread = yield* newThread(vault.id);
  const events = yield* watch(thread.id);
  yield* sendOk(thread.id, "edit the plan");
  yield* events.until(isTag("request.opened"));
  const { token } = yield* tokenFor(thread.id, vault.id);
  return { vault, thread, mcp: yield* mcpSession(token) };
});

const receipts = (threadId: string) =>
  Effect.map(getThread(threadId), ({ events }) => events.flatMap(({ event }) => (event._tag === "schedule.saved" ? [event] : [])));

layer(TestApp)("schedule tools", (it) => {
  it.effect("creates a scheduled prompt and shows its receipt in the conversation", () =>
    Effect.gen(function* () {
      const { vault, thread, mcp } = yield* duringATurn;
      const receipt = yield* mcp.result<Receipt>("schedule_create", {
        kind: "prompt",
        text: "Send me the morning news",
        title: "Morning news",
        repeat: "daily",
        time: "09:00",
      });
      expect(receipt).toMatchObject({
        kind: "prompt",
        status: "active",
        title: "Morning news",
        recurrence: "Every day at 09:00",
        timezone: AKL,
        agent: "No agent (the rules alone)",
        destination: "Inbox",
        editUrl: `/inbox/schedules?edit=${receipt.scheduleId}`,
      });
      expect(receipt.next).toMatch(/, 09:00 NZ[SD]T \(Pacific\/Auckland\)$/);

      const schedule = yield* getSchedule(receipt.scheduleId);
      expect(schedule).toMatchObject({ vaultId: vault.id, kind: "prompt", text: "Send me the morning news" });
      expect(schedule.threadId).not.toBe(thread.id);

      expect(yield* receipts(thread.id)).toEqual([
        expect.objectContaining({ action: "created", scheduleId: receipt.scheduleId, next: receipt.next, href: receipt.editUrl, agent: receipt.agent }),
      ]);
    }),
  );

  it.effect("lists, updates, pauses, resumes, runs and deletes schedules", () =>
    Effect.gen(function* () {
      const { thread, mcp } = yield* duringATurn;
      const created = yield* mcp.result<Receipt>("schedule_create", {
        kind: "reminder",
        text: "Take the bins out",
        repeat: "weekly",
        days: ["tue"],
        time: "19:00",
        linkThisThread: true,
      });
      expect(created.recurrence).toBe("Every Tue at 19:00");
      const listed = yield* mcp.result<{ defaultTimezone: string; schedules: ReadonlyArray<Receipt> }>("schedule_list");
      expect(listed.defaultTimezone).toBe(AKL);
      expect(listed.schedules.map((schedule) => schedule.scheduleId)).toContain(created.scheduleId);

      const updated = yield* mcp.result<Receipt>("schedule_update", { scheduleId: created.scheduleId, time: "18:30" });
      expect(updated.recurrence).toBe("Every Tue at 18:30");
      expect(yield* mcp.result<Receipt>("schedule_pause", { scheduleId: created.scheduleId })).toMatchObject({ status: "paused", next: null });
      expect((yield* mcp.result<Receipt>("schedule_resume", { scheduleId: created.scheduleId })).next).toMatch(/^Tue .*18:30/);
      yield* mcp.result<Receipt>("schedule_run_now", { scheduleId: created.scheduleId });
      expect((yield* getSchedule(created.scheduleId)).runs).toEqual([expect.objectContaining({ status: "delivered", manual: true })]);
      yield* mcp.result<Receipt>("schedule_delete", { scheduleId: created.scheduleId });
      const after = yield* mcp.result<{ schedules: ReadonlyArray<Receipt> }>("schedule_list");
      expect(after.schedules.map((schedule) => schedule.scheduleId)).not.toContain(created.scheduleId);

      expect((yield* receipts(thread.id)).map((receipt) => receipt.action)).toEqual(["created", "updated", "paused", "resumed", "run", "deleted"]);
    }),
  );

  it.effect("says what is missing instead of guessing", () =>
    Effect.gen(function* () {
      const { mcp } = yield* duringATurn;
      const once = yield* mcp.call("schedule_create", { kind: "reminder", text: "Dentist", repeat: "once", time: "09:00" });
      expect(once.isError).toBe(true);
      expect(once.content[0]?.text).toMatch(/needs a date/);
      const unknown = yield* mcp.call("schedule_pause", { scheduleId: "nope" });
      expect(unknown.content[0]?.text).toMatch(/schedule_list/);
    }),
  );
});
