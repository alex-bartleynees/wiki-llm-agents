import type { ProviderInstance } from "@wiki-agents/contracts/providers/model";
import { asc, eq } from "drizzle-orm";
import { Clock, Effect, Layer } from "effect";
import { DbError } from "../../shared/persistence/errors.js";
import { Sqlite } from "../../shared/persistence/sqlite.js";
import type { ProviderAdapter } from "./port.js";
import { ProviderInstanceNotFound, ProviderRegistry } from "./registry.js";
import { ReplayAdapter } from "./replay/adapter.js";
import { providerInstances } from "./table.js";

/** The replay provider's instance, created at startup so there is always one provider. */
export const REPLAY_INSTANCE_ID = "replay";

/** Instances in `provider_instances`, run by the adapters given here. */
export const makeProviderRegistry = (adapters: ReadonlyArray<ProviderAdapter>) =>
  Layer.effect(
    ProviderRegistry,
    Effect.gen(function* () {
      const { db } = yield* Sqlite;
      const query = <A>(run: () => A) => Effect.try({ try: run, catch: (cause) => new DbError({ cause }) });
      const byKind = new Map(adapters.map((adapter) => [adapter.kind, adapter]));

      const now = yield* Clock.currentTimeMillis;
      yield* query(() =>
        db
          .insert(providerInstances)
          .values({ id: REPLAY_INSTANCE_ID, kind: "replay", name: "Replay (recorded, free)", createdAt: new Date(now) })
          .onConflictDoNothing()
          .run(),
      );

      const toInstance = (row: typeof providerInstances.$inferSelect, adapter: ProviderAdapter): ProviderInstance => ({
        id: row.id,
        kind: row.kind,
        name: row.name,
        capabilities: adapter.capabilities,
      });

      const list = query(() => db.select().from(providerInstances).orderBy(asc(providerInstances.createdAt)).all()).pipe(
        Effect.map((rows) =>
          rows.flatMap((row) => {
            const adapter = byKind.get(row.kind);
            return adapter === undefined ? [] : [toInstance(row, adapter)];
          }),
        ),
      );

      const get = Effect.fnUntraced(function* (providerInstanceId: string) {
        const row = yield* query(() => db.select().from(providerInstances).where(eq(providerInstances.id, providerInstanceId)).get());
        const adapter = row === undefined ? undefined : byKind.get(row.kind);
        if (row === undefined || adapter === undefined) return yield* new ProviderInstanceNotFound({ providerInstanceId });
        return { instance: toInstance(row, adapter), adapter };
      });

      const defaultInstance = Effect.flatMap(list, (instances) =>
        instances[0] === undefined
          ? Effect.fail(new ProviderInstanceNotFound({ providerInstanceId: "(default)" }))
          : Effect.succeed(instances[0]),
      );

      return ProviderRegistry.of({ list, defaultInstance, get });
    }),
  );

export const ProviderRegistryLive = makeProviderRegistry([ReplayAdapter]);
