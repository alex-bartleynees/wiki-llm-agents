import { RequestAnswer, RequestPrompt, ThreadEvent, type ThreadSummary } from "@wiki-agents/contracts/threads/model";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Option, Schema } from "effect";
import { DbError } from "../../shared/persistence/errors.js";
import { Sqlite } from "../../shared/persistence/sqlite.js";
import type { PendingRequest } from "./repository.js";
import { ThreadRepository } from "./repository.js";
import { outbox, runtimeRequests, threadEvents, threads, turns } from "./table.js";

const EventJson = Schema.fromJsonString(ThreadEvent);
const encodeEvent = Schema.encodeSync(EventJson);
const decodeEvent = Schema.decodeUnknownSync(EventJson);
const PromptJson = Schema.fromJsonString(RequestPrompt);
const encodePrompt = Schema.encodeSync(PromptJson);
const decodePrompt = Schema.decodeUnknownSync(PromptJson);
const encodeAnswer = Schema.encodeSync(Schema.fromJsonString(RequestAnswer));

const turnStartId = (turnId: string) => `turn.start:${turnId}`;

/** Status is derived: a running turn with a pending request is waiting for you. */
const summaryColumns = {
  id: threads.id,
  vaultId: threads.vaultId,
  title: threads.title,
  providerInstanceId: threads.providerInstanceId,
  createdAt: threads.createdAt,
  updatedAt: threads.updatedAt,
  status: sql<ThreadSummary["status"]>`CASE
    WHEN EXISTS (SELECT 1 FROM runtime_requests r WHERE r.thread_id = threads.id AND r.status = 'pending') THEN 'waiting'
    WHEN EXISTS (SELECT 1 FROM turns t WHERE t.thread_id = threads.id AND t.status = 'running') THEN 'running'
    ELSE 'idle' END`,
  lastSeq: sql<number>`COALESCE((SELECT MAX(e.seq) FROM thread_events e WHERE e.thread_id = threads.id), 0)`,
};

const toSummary = (row: { readonly createdAt: Date; readonly updatedAt: Date } & Omit<ThreadSummary, "createdAt" | "updatedAt">): ThreadSummary => ({
  ...row,
  createdAt: row.createdAt.getTime(),
  updatedAt: row.updatedAt.getTime(),
});

const TITLE_LENGTH = 80;
const titleFrom = (text: string) => {
  const line = text.trim().split("\n")[0]!.trim();
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line;
};

export const ThreadRepositoryLive = Layer.effect(
  ThreadRepository,
  Effect.gen(function* () {
    const { db } = yield* Sqlite;
    const query = <A>(run: () => A) => Effect.try({ try: run, catch: (cause) => new DbError({ cause }) });

    const findSync = (threadId: string) => {
      const row = db.select(summaryColumns).from(threads).where(and(eq(threads.id, threadId), isNull(threads.deletedAt))).get();
      return row === undefined ? Option.none() : Option.some(toSummary(row));
    };

    return ThreadRepository.of({
      insert: (thread) =>
        query(() => {
          const at = new Date(thread.createdAt);
          db.insert(threads).values({ ...thread, createdAt: at, updatedAt: at }).run();
          return Option.getOrThrow(findSync(thread.id));
        }),

      find: (threadId) => query(() => findSync(threadId)),

      listByVault: (vaultId) =>
        query(() =>
          db
            .select(summaryColumns)
            .from(threads)
            .where(and(eq(threads.vaultId, vaultId), isNull(threads.deletedAt)))
            .orderBy(desc(threads.updatedAt), desc(threads.createdAt))
            .all()
            .map(toSummary),
        ),

      events: (threadId, afterSeq) =>
        query(() =>
          db
            .select()
            .from(threadEvents)
            .where(and(eq(threadEvents.threadId, threadId), gt(threadEvents.seq, afterSeq)))
            .orderBy(asc(threadEvents.seq))
            .all()
            .map((row) => ({ threadId, seq: row.seq, at: row.at.getTime(), event: decodeEvent(row.payload) })),
        ),

      append: (threadId, events, at, options) =>
        query(() =>
          db.transaction((tx) => {
            const when = new Date(at);
            const last = tx.get<{ seq: number | null }>(sql`SELECT MAX(seq) AS seq FROM thread_events WHERE thread_id = ${threadId}`);
            let seq = last?.seq ?? 0;
            const stored = events.map((event) => {
              seq += 1;
              tx.insert(threadEvents).values({ threadId, seq, type: event._tag, payload: encodeEvent(event), at: when }).run();
              switch (event._tag) {
                case "user.message":
                  tx.insert(turns).values({ id: event.turnId, threadId, input: event.text, status: "running", startedAt: when }).run();
                  tx.update(threads)
                    .set({ title: sql`COALESCE(${threads.title}, ${titleFrom(event.text)})` })
                    .where(eq(threads.id, threadId))
                    .run();
                  break;
                case "request.opened":
                  tx.insert(runtimeRequests)
                    .values({
                      id: event.requestId,
                      threadId,
                      turnId: event.turnId,
                      prompt: encodePrompt(event.prompt),
                      status: "pending",
                      createdAt: when,
                    })
                    .run();
                  break;
                case "request.resolved":
                  tx.update(runtimeRequests)
                    .set({
                      status: event.answer === null ? "cancelled" : "answered",
                      answer: event.answer === null ? null : encodeAnswer(event.answer),
                      resolvedAt: when,
                    })
                    .where(and(eq(runtimeRequests.id, event.requestId), eq(runtimeRequests.status, "pending")))
                    .run();
                  break;
                case "turn.finished":
                  tx.update(turns)
                    .set({
                      status: event.outcome,
                      endedAt: when,
                      inputTokens: event.usage?.inputTokens ?? null,
                      outputTokens: event.usage?.outputTokens ?? null,
                      costUsd: event.usage?.costUsd ?? null,
                    })
                    .where(eq(turns.id, event.turnId))
                    .run();
                  tx.delete(outbox).where(eq(outbox.id, turnStartId(event.turnId))).run();
                  break;
              }
              return { threadId, seq, at, event };
            });
            if (options?.startTurn !== undefined) {
              tx.insert(outbox)
                .values({
                  id: turnStartId(options.startTurn),
                  kind: "turn.start",
                  payload: JSON.stringify({ threadId, turnId: options.startTurn }),
                  nextAttemptAt: when,
                })
                .run();
            }
            tx.update(threads).set({ updatedAt: when }).where(eq(threads.id, threadId)).run();
            return stored;
          }),
        ),

      markDispatched: (turnId) => query(() => void db.delete(outbox).where(eq(outbox.id, turnStartId(turnId))).run()),

      recovery: (threadId) =>
        query(() => {
          const turn = db
            .select({ id: turns.id, input: turns.input })
            .from(turns)
            .where(and(eq(turns.threadId, threadId), eq(turns.status, "running")))
            .orderBy(desc(turns.startedAt))
            .get();
          const queued = turn !== undefined && db.select({ id: outbox.id }).from(outbox).where(eq(outbox.id, turnStartId(turn.id))).get() !== undefined;
          const pendingRequests = db
            .select()
            .from(runtimeRequests)
            .where(and(eq(runtimeRequests.threadId, threadId), eq(runtimeRequests.status, "pending")))
            .orderBy(asc(runtimeRequests.createdAt), asc(sql`rowid`))
            .all()
            .map((row): PendingRequest => ({ requestId: row.id, turnId: row.turnId, prompt: decodePrompt(row.prompt) }));
          return {
            openTurn: turn === undefined ? Option.none() : Option.some({ ...turn, dispatched: !queued }),
            pendingRequests,
          };
        }),

      findRequest: (threadId, requestId) =>
        query(() => {
          const row = db
            .select({ requestId: runtimeRequests.id, status: runtimeRequests.status })
            .from(runtimeRequests)
            .where(and(eq(runtimeRequests.threadId, threadId), eq(runtimeRequests.id, requestId)))
            .get();
          return Option.fromNullishOr(row);
        }),

      withOpenTurns: query(() =>
        db
          .selectDistinct({ threadId: turns.threadId })
          .from(turns)
          .where(eq(turns.status, "running"))
          .all()
          .map((row) => row.threadId),
      ),
    });
  }),
);
