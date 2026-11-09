import { relative, sep } from "node:path";
import type { Vault } from "@wiki-agents/contracts/vaults/model";
import { watch } from "chokidar";
import { Context, Effect, FileSystem, Layer, Queue, Stream } from "effect";
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

    const changesIn = (root: string) =>
      Stream.callback<string>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() =>
            watch(root, {
              ignoreInitial: true,
              followSymlinks: false,
              ignored: (path) => relative(root, path).split(sep).some(isIgnoredName),
            })
              .on("all", (_event, path) => Queue.offerUnsafe(queue, path))
              .on("error", (error) => Effect.runFork(Effect.logWarning(`watching ${root} failed`, error))),
          ),
          (watcher) => Effect.promise(() => watcher.close()),
        ),
      );

    return VaultWatcher.of({
      watch: (vault) =>
        Effect.gen(function* () {
          if (watching.has(vault.id)) return;
          watching.add(vault.id);
          const root = yield* fs.realPath(vault.rootPath);
          yield* changesIn(root).pipe(
            Stream.runForEach((absolute) => {
              const path = relative(root, absolute).split(sep).join("/");
              if (path === "" || path.startsWith("..")) return Effect.void;
              return debounce(`${vault.id}\0${path}`, indexer.enqueue({ _tag: "Sync", vault, paths: [path] }));
            }),
            Effect.forkIn(scope),
          );
        }).pipe(Effect.catch((error) => Effect.logWarning(`can't watch ${vault.rootPath}`, error))),
    });
  }),
);
