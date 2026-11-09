import { and, asc, eq, sql } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { DbError } from "../../shared/persistence/errors.js";
import { Sqlite } from "../../shared/persistence/sqlite.js";
import { PinRepository } from "./repository.js";
import { pins } from "./table.js";

export const PinRepositoryLive = Layer.effect(
  PinRepository,
  Effect.gen(function* () {
    const { db } = yield* Sqlite;
    const query = <A>(run: () => A) => Effect.try({ try: run, catch: (cause) => new DbError({ cause }) });
    return {
      list: (vaultId) =>
        query(() =>
          db
            .select({ path: pins.path })
            .from(pins)
            .where(eq(pins.vaultId, vaultId))
            .orderBy(asc(sql`rowid`))
            .all()
            .map((row) => row.path),
        ),
      add: (vaultId, path, pinnedAt) => query(() => void db.insert(pins).values({ vaultId, path, pinnedAt }).onConflictDoNothing().run()),
      remove: (vaultId, path) => query(() => void db.delete(pins).where(and(eq(pins.vaultId, vaultId), eq(pins.path, path))).run()),
    };
  }),
);
