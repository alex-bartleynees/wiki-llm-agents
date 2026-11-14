import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeHttpServer } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { sql } from "drizzle-orm";
import { Effect, Layer, type Scope } from "effect";
import { makeHttpApp } from "../../src/app/layers.js";
import { NOT_STARTED } from "../../src/features/schedules/runner.js";
import { makeSqlite, Sqlite } from "../../src/shared/persistence/sqlite.js";
import { makeScriptedProvider } from "./infrastructure/scripted-provider.js";
import { advanceTo, AKL, createSchedule, DAY, getSchedule, itemsOf, ofKind, watchInbox } from "./infrastructure/schedules.js";
import { TestAgents, TestAttachments } from "./infrastructure/test-app.js";
import { newVault } from "./infrastructure/threads.js";

const migrationsDir = fileURLToPath(new URL("../../drizzle", import.meta.url));
const provider = makeScriptedProvider();
let runs = 0;
provider.scripts.set("Morning news", ({ turnId }) =>
  Effect.sync(() => {
    runs++;
    return [{ _tag: "message.delta" as const, turnId, messageId: "m", text: "The news." }];
  }),
);

/** The app over a database file, as if started again; closing the scope stops it. */
const appOn = (file: string) =>
  makeHttpApp({ vaults: [], watch: false, providers: provider.registry, agents: TestAgents, attachments: TestAttachments }).pipe(
    Layer.provideMerge(Layer.effect(Sqlite, makeSqlite({ file, migrationsDir }))),
    Layer.provideMerge(NodeHttpServer.layerTest),
  );

type App = Layer.Success<ReturnType<typeof appOn>>;

const run = <A, E>(file: string, body: Effect.Effect<A, E, App | Scope.Scope>) => Effect.scoped(Effect.provide(body, appOn(file)));

const tempDatabase = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "wiki-agents-schedules-"))),
  (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
).pipe(Effect.map((dir) => join(dir, "app.db")));

const daily = (body: Record<string, unknown>) => createSchedule({ recurrence: { _tag: "daily", time: "09:00" }, timezone: AKL, ...body });

describe("schedules across a restart", () => {
  it.effect("delivers missed reminders once, overdue, and never again", () =>
    Effect.gen(function* () {
      const file = yield* tempDatabase;
      const schedule = yield* run(file, daily({ kind: "reminder", text: "Stretch" }));
      // Off for three slots.
      yield* advanceTo(schedule.nextAt! + 2 * DAY + 60 * 60_000);

      const item = yield* run(
        file,
        Effect.flatMap(watchInbox, (watching) => watching.until(ofKind(schedule.id, "reminder"))),
      );
      expect(item.overdue).toBe(true);

      const after = yield* run(file, Effect.zip(getSchedule(schedule.id), itemsOf(schedule.id)));
      expect(after[0].runs).toEqual([expect.objectContaining({ status: "delivered", overdue: true, coalesced: 2, slotAt: schedule.nextAt! + 2 * DAY })]);
      expect(after[0].nextAt).toBe(schedule.nextAt! + 3 * DAY);
      expect(after[1]).toHaveLength(1);
    }),
  );

  it.effect("runs a missed scheduled prompt at startup when it is still the same day, once", () =>
    Effect.gen(function* () {
      const file = yield* tempDatabase;
      const schedule = yield* run(file, Effect.flatMap(newVault, (vault) => daily({ kind: "prompt", text: "Morning news", vaultId: vault.id, providerInstanceId: "scripted" })));
      yield* advanceTo(schedule.nextAt! + 30 * 60_000);
      const before = runs;

      const item = yield* run(file, Effect.flatMap(watchInbox, (watching) => watching.until(ofKind(schedule.id, "prompt.result"))));
      expect(item).toMatchObject({ body: "The news.", overdue: true });
      expect(runs).toBe(before + 1);

      const after = yield* run(file, getSchedule(schedule.id));
      expect(after.runs).toEqual([expect.objectContaining({ status: "completed", overdue: true })]);
      expect(runs).toBe(before + 1);
    }),
  );

  it.effect("records a scheduled prompt as missed once the day has passed", () =>
    Effect.gen(function* () {
      const file = yield* tempDatabase;
      const schedule = yield* run(file, Effect.flatMap(newVault, (vault) => daily({ kind: "prompt", text: "Morning news", vaultId: vault.id, providerInstanceId: "scripted", title: "News" })));
      // Back at 08:00 two days later: yesterday's 09:00 (and the day before's) were missed.
      yield* advanceTo(schedule.nextAt! + DAY + 23 * 60 * 60_000);
      const before = runs;

      const item = yield* run(file, Effect.flatMap(watchInbox, (watching) => watching.until(ofKind(schedule.id, "prompt.missed"))));
      expect(item).toMatchObject({ title: "Missed: News", overdue: true, body: expect.stringContaining("and 1 earlier time") });
      expect(runs).toBe(before);
      const after = yield* run(file, getSchedule(schedule.id));
      expect(after.runs).toEqual([expect.objectContaining({ status: "missed", coalesced: 1, slotAt: schedule.nextAt! + DAY })]);
      expect(after.nextAt).toBe(schedule.nextAt! + 2 * DAY);
    }),
  );

  it.effect("fails a run whose turn never started, without running it again", () =>
    Effect.gen(function* () {
      const file = yield* tempDatabase;
      const schedule = yield* run(
        file,
        Effect.gen(function* () {
          const schedule = yield* daily({ kind: "prompt", text: "Morning news", vaultId: (yield* newVault).id, providerInstanceId: "scripted", title: "News" });
          // As if the server stopped between recording the run and sending the prompt.
          const { db } = yield* Sqlite;
          db.run(sql`INSERT INTO schedule_runs (id, schedule_id, slot_at, fired_at, status, overdue, coalesced, manual, thread_id, turn_id)
            VALUES ('lost', ${schedule.id}, 1, 1, 'running', 0, 0, 0, ${schedule.threadId}, 'never-sent')`);
          return schedule;
        }),
      );
      const before = runs;
      const item = yield* run(file, Effect.flatMap(watchInbox, (watching) => watching.until(ofKind(schedule.id, "prompt.failed"))));
      expect(item.body).toContain(NOT_STARTED);
      expect(runs).toBe(before);
    }),
  );
});
