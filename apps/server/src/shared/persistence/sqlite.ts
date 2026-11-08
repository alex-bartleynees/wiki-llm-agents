import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { Context, Effect, Layer } from "effect";
import { AppConfig } from "../config.js";
import { DbError } from "./errors.js";

export interface SqliteService {
  readonly db: BetterSQLite3Database;
}

export class Sqlite extends Context.Service<Sqlite, SqliteService>()("Sqlite") {}

/** Opens (or creates) a database file, runs pending migrations, closes it on scope exit. */
export const makeSqlite = (options: { readonly file: string; readonly migrationsDir: string }) =>
  Effect.gen(function* () {
    const client = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const client = new Database(options.file);
          client.pragma("journal_mode = WAL");
          client.pragma("foreign_keys = ON");
          return client;
        },
        catch: (cause) => new DbError({ cause }),
      }),
      (client) => Effect.sync(() => client.close()),
    );
    const db = drizzle(client);
    yield* Effect.try({
      try: () => migrate(db, { migrationsFolder: options.migrationsDir }),
      catch: (cause) => new DbError({ cause }),
    });
    return { db };
  });

export const SqliteLive = Layer.effect(
  Sqlite,
  Effect.gen(function* () {
    const dataDir = yield* AppConfig.dataDir;
    const migrationsDir = yield* AppConfig.migrationsDir;
    mkdirSync(dataDir, { recursive: true });
    return yield* makeSqlite({ file: join(dataDir, "app.db"), migrationsDir });
  }),
);
