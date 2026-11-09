import { relative, sep } from "node:path";
import type { Vault } from "@wiki-agents/contracts/vaults/model";
import { watch } from "chokidar";
import { Context, Deferred, Effect, Fiber, FileSystem, Layer, Queue, Semaphore, Stream } from "effect";
import { isIgnoredName } from "../../shared/vault/path-guard.js";
import { makeDebouncer } from "./debounce.js";
import { Indexer } from "./indexer.js";

/** How long a path must be quiet before it is re-indexed. */
export const DEBOUNCE = "300 millis";

export interface VaultWatcherService {
  /** Starts watching a vault for the life of the app; watching twice is a no-op. */
  readonly watch: (vault: Vault) => Effect.Effect<void>;
}

export class VaultWatcher extends Context.Service<VaultWatcher, VaultWatcherService>()("VaultWatcher") {}

/** For tests and tools that drive the indexer themselves. */
export const VaultWatcherNoop = Layer.succeed(VaultWatcher, VaultWatcher.of({ watch: () => Effect.void }));

/**
 * chokidar per vault → per-path debounce → `Sync` commands for the IndexerActor.
 * Ignored names are never watched. Symlinks are not followed: links to other folders
 * would otherwise watch outside the vault (the next scan still picks them up).
 */
export const VaultWatcherLive = Layer.effect(
  VaultWatcher,
  Effect.gen(function* () {
    const indexer = yield* Indexer;
    const fs = yield* FileSystem.FileSystem;
    const scope = yield* Effect.scope;
    const debounce = yield* makeDebouncer(DEBOUNCE);
    const watching = new Set<string>();
    const lock = yield* Semaphore.make(1);

    const changesIn = (root: string, ready: Deferred.Deferred<void, Error>) =>
      Stream.callback<string | Error>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() =>
            watch(root, {
              ignoreInitial: true,
              followSymlinks: false,
              ignored: (path) => relative(root, path).split(sep).some(isIgnoredName),
            })
              .on("all", (_event, path) => Queue.offerUnsafe(queue, path))
              .on("ready", () => Deferred.doneUnsafe(ready, Effect.void))
              .on("error", (error) => {
                const failure = error instanceof Error ? error : new Error(String(error));
                Deferred.doneUnsafe(ready, Effect.fail(failure));
                Queue.offerUnsafe(queue, failure);
              }),
          ),
          (watcher) => Effect.promise(() => watcher.close()),
        ),
      );

    return VaultWatcher.of({
      watch: (vault) =>
        Effect.gen(function* () {
          if (watching.has(vault.id)) return;
          const root = yield* fs.realPath(vault.rootPath);
          const ready = yield* Deferred.make<void, Error>();
          const fiber = yield* changesIn(root, ready).pipe(
            Stream.runForEach((absolute) => {
              if (absolute instanceof Error) return Effect.logWarning(`watching ${root} failed`, absolute);
              const path = relative(root, absolute).split(sep).join("/");
              if (path === "" || path.startsWith("..")) return Effect.void;
              return debounce(`${vault.id}\0${path}`, indexer.enqueue({ _tag: "Sync", vault, paths: [path] }));
            }),
            Effect.forkIn(scope),
          );
          yield* Deferred.await(ready).pipe(Effect.onError(() => Fiber.interrupt(fiber)));
          watching.add(vault.id);
        }).pipe(lock.withPermits(1), Effect.catch((error) => Effect.logWarning(`can't watch ${vault.rootPath}`, error))),
    });
  }),
);
