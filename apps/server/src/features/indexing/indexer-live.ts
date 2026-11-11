import type { VaultChanged } from "@wiki-agents/contracts/indexing/event";
import type { Vault } from "@wiki-agents/contracts/vaults/model";
import { Deferred, Effect, Exit, FileSystem, Layer, PubSub, Queue } from "effect";
import { type IndexCommand, Indexer, IndexFailed } from "./indexer.js";
import { FileChangeSink } from "./change-sink.js";
import { reconcileVault } from "./reconcile.js";
import { IndexStore } from "./store.js";

interface Job {
  readonly command: IndexCommand;
  readonly done: Deferred.Deferred<void, IndexFailed> | undefined;
}

/** Commands for one vault in a batch, merged: a rebuild or scan covers any syncs. */
interface VaultWork {
  readonly vault: Vault;
  rebuild: boolean;
  full: boolean;
  readonly paths: Set<string>;
  readonly jobs: Array<Job>;
}

const mergeByVault = (jobs: ReadonlyArray<Job>) => {
  const work = new Map<string, VaultWork>();
  for (const job of jobs) {
    const { vault } = job.command;
    const entry = work.get(vault.id) ?? { vault, rebuild: false, full: false, paths: new Set<string>(), jobs: [] };
    work.set(vault.id, entry);
    entry.jobs.push(job);
    if (job.command._tag === "Rebuild") entry.rebuild = true;
    else if (job.command._tag === "Scan") entry.full = true;
    else for (const path of job.command.paths) entry.paths.add(path);
  }
  return [...work.values()];
};

export const IndexerLive = Layer.effect(
  Indexer,
  Effect.gen(function* () {
    const store = yield* IndexStore;
    const fs = yield* FileSystem.FileSystem;
    const sink = yield* FileChangeSink;
    const queue = yield* Queue.unbounded<Job>();
    const changes = yield* PubSub.unbounded<VaultChanged>();

    const apply = (work: VaultWork) =>
      Effect.gen(function* () {
        if (work.rebuild) yield* store.clear(work.vault.id);
        return yield* reconcileVault(work.vault, work.rebuild || work.full ? "all" : work.paths);
      }).pipe(Effect.provideService(IndexStore, store), Effect.provideService(FileSystem.FileSystem, fs), Effect.provideService(FileChangeSink, sink));

    const processBatch = (jobs: ReadonlyArray<Job>) =>
      Effect.forEach(mergeByVault(jobs), (work) =>
        Effect.gen(function* () {
          const exit = yield* Effect.exit(apply(work));
          if (Exit.isSuccess(exit) && exit.value.length > 0) {
            yield* PubSub.publish(changes, { type: "vault.changed", vaultId: work.vault.id, paths: exit.value });
          }
          if (Exit.isFailure(exit)) yield* Effect.logError(`indexing ${work.vault.name} failed`, exit.cause);
          const result = Exit.isSuccess(exit)
            ? Effect.void
            : Effect.fail(new IndexFailed({ vaultId: work.vault.id, cause: exit.cause }));
          for (const job of work.jobs) if (job.done) yield* Deferred.complete(job.done, result);
        }),
      );

    yield* Queue.takeAll(queue).pipe(Effect.flatMap(processBatch), Effect.forever, Effect.forkScoped);

    return Indexer.of({
      run: (command) =>
        Effect.gen(function* () {
          const done = yield* Deferred.make<void, IndexFailed>();
          yield* Queue.offer(queue, { command, done });
          return yield* Deferred.await(done);
        }),
      enqueue: (command) => Effect.asVoid(Queue.offer(queue, { command, done: undefined })),
      subscribe: PubSub.subscribe(changes),
    });
  }),
);
