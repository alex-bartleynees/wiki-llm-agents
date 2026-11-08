import { asc } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { DbError } from "../../shared/persistence/errors.js";
import { Sqlite } from "../../shared/persistence/sqlite.js";
import { VaultRepository } from "./repository.js";
import { vaults } from "./table.js";

export const VaultRepositoryLive = Layer.effect(
  VaultRepository,
  Effect.gen(function* () {
    const { db } = yield* Sqlite;
    return {
      list: Effect.try({
        try: () =>
          db
            .select({ id: vaults.id, name: vaults.name, rootPath: vaults.rootPath })
            .from(vaults)
            .orderBy(asc(vaults.name))
            .all(),
        catch: (cause) => new DbError({ cause }),
      }),
    };
  }),
);
