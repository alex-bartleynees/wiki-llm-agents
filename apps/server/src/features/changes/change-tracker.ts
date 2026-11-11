import { isAbsolute, relative, sep } from "node:path";
import { Clock, Context, Effect, FileSystem, Layer } from "effect";
import type { DbError } from "../../shared/persistence/errors.js";
import { normaliseVaultPath } from "../../shared/vault/path-guard.js";
import { FileChangeSink } from "../indexing/change-sink.js";
import { ChangeLog, type ChangeRecord } from "./change-log.js";

export interface TrackedTurn {
  readonly vaultId: string;
  /** The vault folder as registered; its real path is worked out too. */
  readonly vaultRoot: string;
  readonly threadId: string;
  readonly turnId: string;
  /** The thread's agent id, else its provider instance. */
  readonly actor: string;
}

export interface ChangeTrackerService {
  /** From now until `end`, note changes in the vault are recorded against the turn. */
  readonly begin: (turn: TrackedTurn) => Effect.Effect<void>;
  /** The provider says the turn writes or wrote these files (absolute paths); those in the vault count as the agent's. */
  readonly reportWrites: (turnId: string, paths: ReadonlyArray<string>) => Effect.Effect<void, DbError>;
  /** Stops recording for the turn and returns what it changed. */
  readonly end: (turnId: string) => Effect.Effect<ReadonlyArray<ChangeRecord>, DbError>;
  /**
   * The app itself is about to make the file have `hash` (null: delete it), as undo
   * does; that change isn't recorded against running turns.
   */
  readonly expectWrite: (vaultId: string, path: string, hash: string | null) => Effect.Effect<void>;
}

export class ChangeTracker extends Context.Service<ChangeTracker, ChangeTrackerService>()("ChangeTracker") {}

interface Active extends TrackedTurn {
  readonly roots: ReadonlyArray<string>;
  /** Vault paths the provider reported writing. */
  readonly reported: Set<string>;
}

/** The vault-relative path of `absolute` under one of `roots`, if it is in the vault. */
export const vaultPathOf = (roots: ReadonlyArray<string>, absolute: string): string | undefined => {
  if (!isAbsolute(absolute)) return undefined;
  for (const root of roots) {
    const rel = relative(root, absolute);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) continue;
    const path = normaliseVaultPath(rel.split(sep).join("/"));
    if (path !== undefined) return path;
  }
  return undefined;
};

/**
 * Records note changes against the turns running in their vault: the indexer tells
 * it (as the `FileChangeSink`) about every change it applies, and ThreadActors begin
 * and end turns. A change is the agent's when the provider reported writing the path
 * during the turn, before or after the change was seen; otherwise it is uncertain.
 * Several turns running in one vault each get uncertain changes they didn't report.
 */
export const ChangeTrackerLive = Layer.effectContext(
  Effect.gen(function* () {
    const log = yield* ChangeLog;
    const fs = yield* FileSystem.FileSystem;
    const turns = new Map<string, Active>();
    const expected = new Map<string, string | null>();
    const key = (vaultId: string, path: string) => `${vaultId}\0${path}`;

    const tracker = ChangeTracker.of({
      begin: (turn) =>
        Effect.gen(function* () {
          const real = yield* fs.realPath(turn.vaultRoot).pipe(Effect.orElseSucceed(() => turn.vaultRoot));
          turns.set(turn.turnId, { ...turn, roots: [...new Set([real, turn.vaultRoot])], reported: new Set() });
        }),
      reportWrites: (turnId, paths) =>
        Effect.gen(function* () {
          const turn = turns.get(turnId);
          if (turn === undefined) return;
          const inVault = paths.flatMap((path) => vaultPathOf(turn.roots, path) ?? []);
          for (const path of inVault) turn.reported.add(path);
          yield* log.markAgent(turnId, inVault);
        }),
      end: (turnId) =>
        Effect.suspend(() => {
          turns.delete(turnId);
          return log.forTurn(turnId);
        }),
      expectWrite: (vaultId, path, hash) => Effect.sync(() => void expected.set(key(vaultId, path), hash)),
    });

    const sink = FileChangeSink.of({
      noteChanged: (vaultId, change) =>
        Effect.gen(function* () {
          const expectedKey = key(vaultId, change.path);
          if (expected.has(expectedKey)) {
            const hash = expected.get(expectedKey);
            expected.delete(expectedKey);
            if (hash === change.afterHash) return;
          }
          const running = [...turns.values()].filter((turn) => turn.vaultId === vaultId);
          if (running.length === 0) return;
          const at = yield* Clock.currentTimeMillis;
          for (const turn of running) {
            yield* log.record({
              vaultId,
              threadId: turn.threadId,
              turnId: turn.turnId,
              actor: turn.actor,
              path: change.path,
              beforeHash: change.beforeHash,
              afterHash: change.afterHash,
              attribution: turn.reported.has(change.path) ? "agent" : "uncertain",
              at,
            });
          }
        }),
    });

    return Context.make(ChangeTracker, tracker).pipe(Context.add(FileChangeSink, sink));
  }),
);
