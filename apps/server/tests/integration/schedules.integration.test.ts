import { expect, layer } from "@effect/vitest";
import { PauseScheduleResponse } from "@wiki-agents/contracts/schedules/pause-schedule/response";
import { ResumeScheduleResponse } from "@wiki-agents/contracts/schedules/resume-schedule/response";
import { RunScheduleNowResponse } from "@wiki-agents/contracts/schedules/run-schedule-now/response";
import { UpdateScheduleResponse } from "@wiki-agents/contracts/schedules/update-schedule/response";
import { Clock, Effect } from "effect";
import { HttpClient } from "effect/http";
import { ProviderError } from "../../src/features/providers/port.js";
import { localDate, zonedTime } from "../../src/shared/time/recurrence.js";
import { STILL_RUNNING } from "../../src/features/schedules/runner.js";
import { UNATTENDED_ANSWER } from "../../src/features/threads/thread-actor.js";
import { makeScriptedProvider } from "./infrastructure/scripted-provider.js";
import { advanceTo, AKL, createSchedule, DAY, del, getSchedule, inbox, itemsOf, ofKind, patch, threadEvent, watchInbox } from "./infrastructure/schedules.js";
import { makeTestApp } from "./infrastructure/test-app.js";
import { decode, getThread, newVault, post } from "./infrastructure/threads.js";

const provider = makeScriptedProvider();

layer(makeTestApp({ providers: provider.registry }))("reminders", (it) => {
  it.effect("fires a daily reminder into the inbox at its local time, once, and moves to the next day", () =>
    Effect.gen(function* () {
      const vault = yield* newVault;
      const schedule = yield* createSchedule({
        kind: "reminder",
        text: "Water the plants\nThe ones on the deck",
        recurrence: { _tag: "daily", time: "09:00" },
        timezone: AKL,
        link: { _tag: "note", vaultId: vault.id, path: "index.md" },
      });
      expect(schedule).toMatchObject({ title: "Water the plants", status: "active", recurrenceLabel: "Every day at 09:00", runs: [] });
      expect(schedule.nextLabel).toMatch(/, 09:00 NZ[SD]T \(Pacific\/Auckland\)$/);

      const watching = yield* watchInbox;
      const item = yield* watching.until(ofKind(schedule.id, "reminder"), advanceTo(schedule.nextAt!));
      expect(item).toMatchObject({
        title: "Water the plants",
        body: "Water the plants\nThe ones on the deck",
        state: "open",
        read: false,
        overdue: false,
        source: { scheduleId: schedule.id, vaultId: vault.id, notePath: "index.md" },
      });

      const after = yield* getSchedule(schedule.id);
      expect(after.nextAt).toBe(schedule.nextAt! + DAY);
      expect(after.runs).toEqual([expect.objectContaining({ status: "delivered", slotAt: schedule.nextAt, overdue: false, coalesced: 0, manual: false })]);
      expect(yield* itemsOf(schedule.id)).toHaveLength(1);
    }),
  );

  it.effect("fires a one-off once and then it is finished", () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const date = localDate(now + 2 * DAY, AKL);
      const schedule = yield* createSchedule({ kind: "reminder", text: "Call the dentist", recurrence: { _tag: "once", date, time: "10:15" } });
      expect(schedule.timezone).toBe(AKL);
      expect(schedule.nextAt).toBe(zonedTime(date, "10:15", AKL));
      expect(schedule.recurrenceLabel).toBe(`Once on ${date} at 10:15`);

      const watching = yield* watchInbox;
      yield* watching.until(ofKind(schedule.id, "reminder"), advanceTo(schedule.nextAt!));
      expect(yield* getSchedule(schedule.id)).toMatchObject({ status: "finished", nextAt: null, nextLabel: null });
    }),
  );

  it.effect("refuses what can't be scheduled, saying why", () =>
    Effect.gen(function* () {
      const refused = (body: Record<string, unknown>) => Effect.flatMap(post("/api/schedules", body), (response) => Effect.map(response.text, (text) => [response.status, text] as const));
      expect(yield* refused({ kind: "reminder", text: "Old", recurrence: { _tag: "once", date: "1960-01-01", time: "09:00" } })).toEqual([400, expect.stringMatching(/already passed/)]);
      expect(yield* refused({ kind: "reminder", text: "Where", recurrence: { _tag: "daily", time: "09:00" }, timezone: "Mars/Olympus" })).toEqual([400, expect.stringMatching(/Unknown timezone/)]);
      expect(yield* refused({ kind: "reminder", text: "Bad", recurrence: { _tag: "daily", time: "25:00" } })).toEqual([400, expect.any(String)]);
      expect(yield* refused({ kind: "prompt", text: "News", recurrence: { _tag: "daily", time: "09:00" } })).toEqual([400, expect.stringMatching(/needs a vault/)]);
      expect(yield* refused({ kind: "reminder", text: "Hi", recurrence: { _tag: "daily", time: "09:00" }, agentId: "x" })).toEqual([400, expect.stringMatching(/scheduled prompt/)]);
    }),
  );

  it.effect("pauses, resumes, edits, runs now and deletes", () =>
    Effect.gen(function* () {
      const schedule = yield* createSchedule({ kind: "reminder", text: "Stretch", recurrence: { _tag: "weekly", days: [1, 3, 5], time: "15:00" } });
      expect(schedule.recurrenceLabel).toBe("Every Mon, Wed, Fri at 15:00");

      const paused = yield* post(`/api/schedules/${schedule.id}/pause`, {}).pipe(Effect.flatMap(decode(PauseScheduleResponse)));
      expect(paused.schedule).toMatchObject({ status: "paused", nextAt: null, pausedReason: null });
      const resumed = yield* post(`/api/schedules/${schedule.id}/resume`, {}).pipe(Effect.flatMap(decode(ResumeScheduleResponse)));
      expect(resumed.schedule).toMatchObject({ status: "active", nextAt: schedule.nextAt });

      const edited = yield* patch(`/api/schedules/${schedule.id}`, { text: "Stand up and stretch", recurrence: { _tag: "weekly", days: [6, 7], time: "08:00" } }).pipe(
        Effect.flatMap(decode(UpdateScheduleResponse)),
      );
      expect(edited.schedule).toMatchObject({ title: "Stretch", text: "Stand up and stretch", recurrenceLabel: "Weekends at 08:00" });
      expect(edited.schedule.nextLabel).toMatch(/^(Sat|Sun) .*08:00/);

      const watching = yield* watchInbox;
      const ran = yield* watching.until(
        (item) => item.source.scheduleId === schedule.id,
        post(`/api/schedules/${schedule.id}/run`, {}).pipe(Effect.flatMap(decode(RunScheduleNowResponse))),
      );
      expect(ran).toMatchObject({ kind: "reminder", body: "Stand up and stretch" });
      const afterRun = yield* getSchedule(schedule.id);
      expect(afterRun.runs).toEqual([expect.objectContaining({ status: "delivered", manual: true })]);
      expect(afterRun.nextAt).toBe(edited.schedule.nextAt);

      expect((yield* del(`/api/schedules/${schedule.id}`)).status).toBe(200);
      expect((yield* HttpClient.get(`/api/schedules/${schedule.id}`)).status).toBe(404);
      // Its inbox item stays.
      expect(yield* itemsOf(schedule.id)).toHaveLength(1);
    }),
  );
});

layer(makeTestApp())("daylight saving", (it) => {
  it.effect("moves a time in the spring-forward gap to after it, then back to the usual time", () =>
    Effect.gen(function* () {
      // Sat 25 Sep 2027, 12:00 NZST; daylight saving starts at 02:00 on Sun 26 Sep.
      yield* advanceTo(Date.parse("2027-09-25T00:00:00Z"));
      const schedule = yield* createSchedule({ kind: "reminder", text: "Night owl", recurrence: { _tag: "daily", time: "02:30" }, timezone: AKL });
      expect(schedule.nextAt).toBe(Date.parse("2027-09-25T14:30:00Z"));
      expect(schedule.nextLabel).toBe("Sun 26 Sep 2027, 03:30 NZDT (Pacific/Auckland)");

      const watching = yield* watchInbox;
      yield* watching.until(ofKind(schedule.id, "reminder"), advanceTo(schedule.nextAt!));
      expect((yield* getSchedule(schedule.id)).nextLabel).toBe("Mon 27 Sep 2027, 02:30 NZDT (Pacific/Auckland)");
    }),
  );

  it.effect("fires once when the time happens twice as daylight saving ends", () =>
    Effect.gen(function* () {
      // Sat 1 Apr 2028, 12:00 NZDT; daylight saving ends at 03:00 on Sun 2 Apr, so 02:30 happens twice.
      yield* advanceTo(Date.parse("2028-03-31T23:00:00Z"));
      const schedule = yield* createSchedule({ kind: "reminder", text: "Twice?", recurrence: { _tag: "daily", time: "02:30" }, timezone: AKL });
      expect(schedule.nextLabel).toBe("Sun 2 Apr 2028, 02:30 NZDT (Pacific/Auckland)");

      const watching = yield* watchInbox;
      yield* watching.until(ofKind(schedule.id, "reminder"), advanceTo(schedule.nextAt!));
      // The second 02:30 (NZST, an hour later) is skipped; the next is Monday's.
      const after = yield* getSchedule(schedule.id);
      expect(after.nextLabel).toBe("Mon 3 Apr 2028, 02:30 NZST (Pacific/Auckland)");
      yield* advanceTo(schedule.nextAt! + 60 * 60_000 + 1);
      expect((yield* getSchedule(schedule.id)).runs).toHaveLength(1);
    }),
  );
});

const say = (turnId: string, text: string) => ({ _tag: "message.delta" as const, turnId, messageId: `${turnId}-m`, text });

provider.scripts.set("Summarise the morning news", ({ turnId }) =>
  Effect.succeed([
    { _tag: "message.delta", turnId, messageId: `${turnId}-a`, text: "Let me look." },
    { _tag: "message.delta", turnId, messageId: `${turnId}-b`, text: "**Headlines:** tea prices rise." },
    { _tag: "turn.finished", turnId, outcome: "completed", usage: { inputTokens: 120, outputTokens: 30, costUsd: 0.002 }, reason: null },
  ]),
);
provider.scripts.set("Tidy the inbox note", ({ turnId }) =>
  Effect.succeed([
    { _tag: "request.opened", turnId, requestId: `${turnId}-edit`, prompt: { _tag: "approval", title: "Edit Inbox.md", detail: "rewrite" } },
    { _tag: "request.opened", turnId, requestId: `${turnId}-ask`, prompt: { _tag: "question", question: "Which section?", options: ["Top", "Bottom"] } },
    say(turnId, "I couldn't edit Inbox.md: the edit was denied."),
    { _tag: "turn.finished", turnId, outcome: "completed", usage: null, reason: null },
  ]),
);
// Waits forever: its approval is denied, but the provider never finishes.
provider.scripts.set("Think for a long time", ({ turnId }) =>
  Effect.succeed([{ _tag: "request.opened", turnId, requestId: `${turnId}-r`, prompt: { _tag: "approval", title: "Run a command", detail: "sleep" } }]),
);
provider.scripts.set("Fetch the weather", () => Effect.fail(new ProviderError({ message: "The weather service is down." })));

const prompt = (vaultId: string, text: string, extra: Record<string, unknown> = {}) =>
  createSchedule({ kind: "prompt", text, recurrence: { _tag: "daily", time: "09:00" }, timezone: AKL, vaultId, providerInstanceId: "scripted", ...extra });

layer(makeTestApp({ providers: provider.registry }))("scheduled prompts", (it) => {
  it.effect("runs the prompt unattended in its own thread and puts the agent's answer in the inbox", () =>
    Effect.gen(function* () {
      const vault = yield* newVault;
      const schedule = yield* prompt(vault.id, "Summarise the morning news", { title: "Morning news" });
      expect(schedule.threadId).not.toBeNull();
      expect((yield* getThread(schedule.threadId!)).thread).toMatchObject({ title: "Scheduled: Morning news", providerInstanceId: "scripted" });

      const watching = yield* watchInbox;
      const item = yield* watching.until(ofKind(schedule.id, "prompt.result"), advanceTo(schedule.nextAt!));
      expect(item).toMatchObject({ title: "Morning news", body: "**Headlines:** tea prices rise.", source: { threadId: schedule.threadId, vaultId: vault.id } });

      const run = (yield* getSchedule(schedule.id)).runs[0]!;
      expect(run).toMatchObject({ status: "completed", inputTokens: 120, outputTokens: 30, costUsd: 0.002, threadId: schedule.threadId, turnId: item.source.turnId });
      const { events } = yield* getThread(schedule.threadId!);
      expect(events[0]?.event).toMatchObject({ _tag: "user.message", text: "Summarise the morning news", unattended: true, turnId: run.turnId });
      // A scheduled run's turn doesn't add a "turn finished" item of its own.
      expect((yield* inbox).filter((candidate) => candidate.source.threadId === schedule.threadId)).toHaveLength(1);
    }),
  );

  it.effect("denies approvals and questions instead of waiting, and the result says what it couldn't do", () =>
    Effect.gen(function* () {
      const schedule = yield* prompt((yield* newVault).id, "Tidy the inbox note");
      const watching = yield* watchInbox;
      const item = yield* watching.until(ofKind(schedule.id, "prompt.result"), advanceTo(schedule.nextAt!));
      expect(item.body).toContain("I couldn't edit Inbox.md");
      expect(item.body).toContain("What it couldn't do unattended");
      expect(item.body).toContain("“Edit Inbox.md” was denied");
      expect(item.body).toContain("“Which section?” wasn't answered");

      const resolved = (yield* getThread(schedule.threadId!)).events.flatMap(({ event }) => (event._tag === "request.resolved" ? [event.answer] : []));
      expect(resolved).toEqual([{ _tag: "approval", decision: "deny" }, { _tag: "question", text: UNATTENDED_ANSWER }]);
      expect((yield* inbox).filter((candidate) => candidate.kind === "request" && candidate.source.threadId === schedule.threadId)).toEqual([]);
    }),
  );

  it.effect("skips an occurrence while the previous run is still going, and refuses Run now", () =>
    Effect.gen(function* () {
      const vault = yield* newVault;
      const schedule = yield* prompt(vault.id, "Think for a long time");
      yield* threadEvent(schedule.threadId!, (event) => event._tag === "request.resolved", advanceTo(schedule.nextAt!));
      expect((yield* post(`/api/schedules/${schedule.id}/run`, {})).status).toBe(409);

      // A reminder a minute after the next slot shows the scheduler has been past it.
      const marker = yield* createSchedule({
        kind: "reminder",
        text: "Marker",
        recurrence: { _tag: "once", date: localDate(schedule.nextAt! + DAY, AKL), time: "09:01" },
        timezone: AKL,
      });
      const watching = yield* watchInbox;
      yield* watching.until(ofKind(marker.id, "reminder"), advanceTo(marker.nextAt!));
      const runs = (yield* getSchedule(schedule.id)).runs;
      expect(runs.map((run) => run.status)).toEqual(["skipped", "running"]);
      expect(runs[0]).toMatchObject({ reason: STILL_RUNNING, slotAt: schedule.nextAt! + DAY });
      expect(yield* itemsOf(schedule.id)).toEqual([]);
    }),
  );

  it.effect("puts a failed run in the inbox without running it again, and pauses after three in a row", () =>
    Effect.gen(function* () {
      const schedule = yield* prompt((yield* newVault).id, "Fetch the weather", { title: "Weather" });
      const watching = yield* watchInbox;
      const first = yield* watching.until(ofKind(schedule.id, "prompt.failed"), advanceTo(schedule.nextAt!));
      expect(first).toMatchObject({ title: "Failed: Weather", body: expect.stringContaining("The weather service is down.") });
      const afterFirst = yield* getSchedule(schedule.id);
      expect(afterFirst).toMatchObject({ status: "active", nextAt: schedule.nextAt! + DAY });
      expect(afterFirst.runs.map((run) => run.status)).toEqual(["failed"]);

      yield* watching.until((item) => ofKind(schedule.id, "prompt.failed")(item) && item.id !== first.id, advanceTo(schedule.nextAt! + DAY));
      const third = yield* watching.until(
        (item) => ofKind(schedule.id, "prompt.failed")(item) && item.title === "Paused: Weather",
        advanceTo(schedule.nextAt! + 2 * DAY),
      );
      expect(third.body).toMatch(/Paused after 3 failed runs in a row/);
      const paused = yield* getSchedule(schedule.id);
      expect(paused).toMatchObject({ status: "paused", nextAt: null, pausedReason: expect.stringMatching(/3 failed runs/) });
      expect(paused.runs.map((run) => run.status)).toEqual(["failed", "failed", "failed"]);
    }),
  );
});
