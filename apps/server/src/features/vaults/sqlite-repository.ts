import { asc, eq } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DbError } from "../../shared/persistence/errors.js";
import { Sqlite } from "../../shared/persistence/sqlite.js";
import { VaultRepository } from "./repository.js";
import { vaults } from "./table.js";

const columns = { id: vaults.id, name: vaults.name, rootPath: vaults.rootPath };

export const VaultRepositoryLive = Layer.effect(
  VaultRepository,
  Effect.gen(function* () {
    const { db } = yield* Sqlite;
    const query = <A>(run: () => A) => Effect.try({ try: run, catch: (cause) => new DbError({ cause }) });
    return {
      list: query(() => db.select(columns).from(vaults).orderBy(asc(vaults.name)).all()),
      findById: (id) =>
        query(() => Option.fromNullishOr(db.select(columns).from(vaults).where(eq(vaults.id, id)).get())),
      findByRootPath: (rootPath) =>
        query(() => Option.fromNullishOr(db.select(columns).from(vaults).where(eq(vaults.rootPath, rootPath)).get())),
      insert: (vault) => query(() => void db.insert(vaults).values(vault).run()),
    };
  }),
);
