import { randomUUID } from "node:crypto";
import { Recurrence, type ScheduleRun, ScheduleLink } from "@wiki-agents/contracts/schedules/model";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { Effect, Layer, Option, Schema } from "effect";
import { DbError } from "../../shared/persistence/errors.js";
import { Sqlite } from "../../shared/persistence/sqlite.js";
import { insertInboxItem } from "../inbox/rows.js";
import { ScheduleRepository, type StoredSchedule } from "./repository.js";
import { scheduleRuns, schedules } from "./table.js";

const RecurrenceJson = Schema.fromJsonString(Recurrence);
const encodeRecurrence = Schema.encodeSync(RecurrenceJson);
const decodeRecurrence = Schema.decodeUnknownSync(RecurrenceJson);
const LinkJson = Schema.fromJsonString(ScheduleLink);
const encodeLink = Schema.encodeSync(LinkJson);
const decodeLink = Schema.decodeUnknownSync(LinkJson);

type ScheduleRow = typeof schedules.$inferSelect;
type RunRow = typeof scheduleRuns.$inferSelect;

const toSchedule = (row: ScheduleRow): StoredSchedule => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  text: row.text,
  recurrence: decodeRecurrence(row.recurrence),
  timezone: row.timezone,
  vaultId: row.vaultId,
  projectId: row.projectId,
  agentId: row.agentId,
  providerInstanceId: row.providerInstanceId,
  model: row.model,
  link: row.link === null ? null : decodeLink(row.link),
  missed: row.missedPolicy,
  threadId: row.threadId,
  status: row.status,
  pausedReason: row.pausedReason,
  nextAt: row.nextAt?.getTime() ?? null,
  createdAt: row.createdAt.getTime(),
  updatedAt: row.updatedAt.getTime(),
});

const toRow = (schedule: StoredSchedule): ScheduleRow => ({
  id: schedule.id,
  kind: schedule.kind,
  title: schedule.title,
  text: schedule.text,
  recurrence: encodeRecurrence(schedule.recurrence),
  timezone: schedule.timezone,
  vaultId: schedule.vaultId,
  projectId: schedule.projectId,
  agentId: schedule.agentId,
  providerInstanceId: schedule.providerInstanceId,
  model: schedule.model,
  link: schedule.link === null ? null : encodeLink(schedule.link),
  threadId: schedule.threadId,
  missedPolicy: schedule.missed,
  status: schedule.status,
  pausedReason: schedule.pausedReason,
  nextAt: schedule.nextAt === null ? null : new Date(schedule.nextAt),
  createdAt: new Date(schedule.createdAt),
  updatedAt: new Date(schedule.updatedAt),
});

const toRun = (row: RunRow): ScheduleRun => ({
  id: row.id,
  scheduleId: row.scheduleId,
  slotAt: row.slotAt.getTime(),
  firedAt: row.firedAt.getTime(),
  status: row.status,
  overdue: row.overdue,
  coalesced: row.coalesced,
  manual: row.manual,
  threadId: row.threadId,
  turnId: row.turnId,
  reason: row.reason,
  inputTokens: row.inputTokens,
  outputTokens: row.outputTokens,
  costUsd: row.costUsd,
  endedAt: row.endedAt?.getTime() ?? null,
});

export const ScheduleRepositoryLive = Layer.effect(
  ScheduleRepository,
  Effect.gen(function* () {
    const { db } = yield* Sqlite;
    const query = <A>(run: () => A) => Effect.try({ try: run, catch: (cause) => new DbError({ cause }) });
    const findSync = (scheduleId: string) => {
      const row = db.select().from(schedules).where(eq(schedules.id, scheduleId)).get();
      return row === undefined ? Option.none() : Option.some(toSchedule(row));
    };
    const runSync = (where: ReturnType<typeof eq>) => {
      const row = db.select().from(scheduleRuns).where(where).orderBy(desc(scheduleRuns.firedAt)).get();
      return row === undefined ? Option.none<ScheduleRun>() : Option.some(toRun(row));
    };

    return ScheduleRepository.of({
      insert: (schedule) =>
        query(() => {
          db.insert(schedules).values(toRow(schedule)).run();
          return Option.getOrThrow(findSync(schedule.id));
        }),

      find: (scheduleId) => query(() => findSync(scheduleId)),

      list: query(() => db.select().from(schedules).orderBy(desc(schedules.createdAt)).all().map(toSchedule)),

      save: (schedule) =>
        query(() => {
          const { id: _id, createdAt: _createdAt, ...fields } = toRow(schedule);
          db.update(schedules).set(fields).where(eq(schedules.id, schedule.id)).run();
          return Option.getOrThrow(findSync(schedule.id));
        }),

      remove: (scheduleId) =>
        query(() =>
          db.transaction((tx) => {
            tx.delete(scheduleRuns).where(eq(scheduleRuns.scheduleId, scheduleId)).run();
            return tx.delete(schedules).where(eq(schedules.id, scheduleId)).run().changes > 0;
          }),
        ),

      runs: (scheduleIds, limit) =>
        query(() => {
          if (scheduleIds.length === 0) return [];
          // The latest `limit` of each schedule.
          const ranked = db
            .select({
              id: scheduleRuns.id,
              rank: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${scheduleRuns.scheduleId} ORDER BY ${scheduleRuns.firedAt} DESC, ${scheduleRuns.slotAt} DESC)`.as("rank"),
            })
            .from(scheduleRuns)
            .where(inArray(scheduleRuns.scheduleId, [...scheduleIds]))
            .as("ranked");
          return db
            .select({ run: scheduleRuns })
            .from(scheduleRuns)
            .innerJoin(ranked, eq(ranked.id, scheduleRuns.id))
            .where(lte(ranked.rank, limit))
            .orderBy(desc(scheduleRuns.firedAt), desc(scheduleRuns.slotAt))
            .all()
            .map(({ run }) => toRun(run));
        }),

      due: (now) =>
        query(() =>
          db
            .select()
            .from(schedules)
            .where(and(eq(schedules.status, "active"), lte(schedules.nextAt, new Date(now))))
            .orderBy(asc(schedules.nextAt))
            .all()
            .map(toSchedule),
        ),

      nextDueAt: query(() => {
        const row = db.get<{ at: number | null }>(sql`SELECT MIN(next_at) AS at FROM schedules WHERE status = 'active'`);
        return row?.at ?? null;
      }),

      recordOccurrence: (occurrence, channels) =>
        query(() =>
          db.transaction((tx) => {
            const id = randomUUID();
            const inserted = tx
              .insert(scheduleRuns)
              .values({
                id,
                scheduleId: occurrence.scheduleId,
                slotAt: new Date(occurrence.slotAt),
                firedAt: new Date(occurrence.firedAt),
                status: occurrence.status,
                overdue: occurrence.overdue,
                coalesced: occurrence.coalesced,
                manual: occurrence.manual,
                threadId: occurrence.threadId,
                turnId: occurrence.turnId,
                reason: occurrence.reason,
                endedAt: occurrence.status === "running" ? null : new Date(occurrence.firedAt),
              })
              .onConflictDoNothing()
              .run();
            const at = new Date(occurrence.firedAt);
            if (occurrence.advance !== null) {
              tx.update(schedules)
                .set({
                  status: occurrence.advance.status,
                  nextAt: occurrence.advance.nextAt === null ? null : new Date(occurrence.advance.nextAt),
                  updatedAt: at,
                })
                .where(eq(schedules.id, occurrence.scheduleId))
                .run();
            }
            // Already recorded (a slot can only fire once): the schedule still moves on.
            if (inserted.changes === 0) return Option.none();
            if (occurrence.item !== null) insertInboxItem(tx, occurrence.item, channels, occurrence.firedAt);
            return Option.some(toRun(tx.select().from(scheduleRuns).where(eq(scheduleRuns.id, id)).get()!));
          }),
        ),

      runningRun: (scheduleId) => query(() => runSync(and(eq(scheduleRuns.scheduleId, scheduleId), eq(scheduleRuns.status, "running"))!)),

      runningRuns: query(() => db.select().from(scheduleRuns).where(eq(scheduleRuns.status, "running")).all().map(toRun)),

      findRunByTurn: (turnId) => query(() => runSync(eq(scheduleRuns.turnId, turnId))),

      finishRun: (runId, result, channels) =>
        query(() =>
          db.transaction((tx) => {
            const ended = tx
              .update(scheduleRuns)
              .set({
                status: result.status,
                reason: result.reason,
                inputTokens: result.usage?.inputTokens ?? null,
                outputTokens: result.usage?.outputTokens ?? null,
                costUsd: result.usage?.costUsd ?? null,
                endedAt: new Date(result.endedAt),
              })
              .where(and(eq(scheduleRuns.id, runId), eq(scheduleRuns.status, "running")))
              .run();
            if (ended.changes === 0) return false;
            if (result.item !== null) insertInboxItem(tx, result.item, channels, result.endedAt);
            if (result.pause !== null) {
              const run = tx.select({ scheduleId: scheduleRuns.scheduleId }).from(scheduleRuns).where(eq(scheduleRuns.id, runId)).get()!;
              tx.update(schedules)
                .set({ status: "paused", pausedReason: result.pause, nextAt: null, updatedAt: new Date(result.endedAt) })
                .where(eq(schedules.id, run.scheduleId))
                .run();
            }
            return true;
          }),
        ),

      failuresInARow: (scheduleId) =>
        query(() => {
          const ended = db
            .select({ status: scheduleRuns.status })
            .from(scheduleRuns)
            .where(and(eq(scheduleRuns.scheduleId, scheduleId), inArray(scheduleRuns.status, ["completed", "failed"])))
            .orderBy(desc(scheduleRuns.endedAt))
            .limit(20)
            .all();
          const firstSuccess = ended.findIndex((run) => run.status === "completed");
          return firstSuccess === -1 ? ended.length : firstSuccess;
        }),
    });
  }),
);
