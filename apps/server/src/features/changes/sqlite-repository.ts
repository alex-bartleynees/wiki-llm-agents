import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DbError } from "../../shared/persistence/errors.js";
import { Sqlite } from "../../shared/persistence/sqlite.js";
import { ChangeLog, type ChangeRecord } from "./change-log.js";
import { fileChanges } from "./table.js";

const toRecord = (row: typeof fileChanges.$inferSelect): ChangeRecord => ({
  ...row,
  recordedAt: row.recordedAt.getTime(),
  undoneAt: row.undoneAt === null ? null : row.undoneAt.getTime(),
});

export const ChangeLogLive = Layer.effect(
  ChangeLog,
  Effect.gen(function* () {
    const { db } = yield* Sqlite;
    const query = <A>(run: () => A) => Effect.try({ try: run, catch: (cause) => new DbError({ cause }) });
    const transaction = <A>(run: () => A) => query(() => db.transaction(run));

    return ChangeLog.of({
      record: (change) =>
        transaction(() => {
          const existing = db
            .select()
            .from(fileChanges)
            .where(and(eq(fileChanges.turnId, change.turnId), eq(fileChanges.path, change.path), isNull(fileChanges.undoneAt)))
            .get();
          if (existing === undefined) {
            if (change.beforeHash === change.afterHash) return;
            db.insert(fileChanges)
              .values({
                id: randomUUID(),
                vaultId: change.vaultId,
                threadId: change.threadId,
                turnId: change.turnId,
                path: change.path,
                beforeHash: change.beforeHash,
                afterHash: change.afterHash,
                attribution: change.attribution,
                actor: change.actor,
                recordedAt: new Date(change.at),
              })
              .run();
            return;
          }
          if (existing.beforeHash === change.afterHash) {
            db.delete(fileChanges).where(eq(fileChanges.id, existing.id)).run();
            return;
          }
          db.update(fileChanges)
            .set({
              afterHash: change.afterHash,
              recordedAt: new Date(change.at),
              ...(change.attribution === "agent" ? { attribution: "agent" as const } : {}),
            })
            .where(eq(fileChanges.id, existing.id))
            .run();
        }),

      markAgent: (turnId, paths) =>
        paths.length === 0
          ? Effect.void
          : query(() => {
              db.update(fileChanges)
                .set({ attribution: "agent" })
                .where(and(eq(fileChanges.turnId, turnId), inArray(fileChanges.path, [...paths])))
                .run();
            }),

      forTurn: (turnId) =>
        query(() => db.select().from(fileChanges).where(eq(fileChanges.turnId, turnId)).orderBy(asc(fileChanges.path)).all().map(toRecord)),

      find: (changeId) =>
        query(() => Option.map(Option.fromNullishOr(db.select().from(fileChanges).where(eq(fileChanges.id, changeId)).get()), toRecord)),

      markUndone: (changeId, at) =>
        query(() => {
          db.update(fileChanges).set({ undoneAt: new Date(at) }).where(eq(fileChanges.id, changeId)).run();
        }),

      lastAgentEdit: (vaultId, path) =>
        query(() => {
          const row = db
            .select({ actor: fileChanges.actor, threadId: fileChanges.threadId, at: fileChanges.recordedAt })
            .from(fileChanges)
            .where(
              and(
                eq(fileChanges.vaultId, vaultId),
                eq(fileChanges.path, path),
                eq(fileChanges.attribution, "agent"),
                isNull(fileChanges.undoneAt),
                isNotNull(fileChanges.afterHash),
              ),
            )
            .orderBy(desc(fileChanges.recordedAt))
            .limit(1)
            .get();
          return Option.map(Option.fromNullishOr(row), (found) => ({ ...found, at: found.at.getTime() }));
        }),
    });
  }),
);
