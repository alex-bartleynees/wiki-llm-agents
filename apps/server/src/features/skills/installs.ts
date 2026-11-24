import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import type { BundleDifference, InstallAction, InstallTarget, PhysicalDestination, Review } from "@wiki-agents/contracts/skills/model";
import { sha256 } from "../../shared/config-files.js";
import { removeEmptyDirectory } from "../../shared/node-files.js";
import { bundleChanges, type Bundle, type Guard, info, installedBundleDifferences, markdown, readBundle, readRegular, type StorageFailure, writeBundle } from "./bundle.js";
import { SkillConflict, isSkillProblem } from "./errors.js";
import { writeAtomic } from "./state-file.js";

const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Version = Schema.NullOr(Digest);
const WorkspaceId = Schema.String.check(Schema.isPattern(/^[a-f0-9-]{36}$/));
const State = Schema.Struct({ current: Version, previous: Version, skillPath: Schema.String, transaction: WorkspaceId });
const Journal = Schema.Struct({ next: State, workspace: WorkspaceId, before: Version });
type State = typeof State.Type;
type Journal = typeof Journal.Type;

export function installStateFolder(dataDir: string, destination: string, name: string) {
  return join(dataDir, "skill-installs", sha256(Buffer.from(destination)), name);
}

const conflict = (message: string) => new SkillConflict({ message });

const checkDirectory = Effect.fnUntraced(function* (path: string, guard: Guard) {
  yield* guard(path);
  const stat = yield* info(path);
  if (stat !== undefined && stat.type !== "Directory") return yield* conflict("The destination or its management directory is unsafe.");
});

export const removeTree = (path: string): Effect.Effect<void, StorageFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const stat = yield* info(path);
    if (stat === undefined) return;
    if (stat.type !== "Directory") return yield* fs.remove(path);
    if ((stat.mode & 0o700) !== 0o700) yield* fs.chmod(path, (stat.mode & 0o777) | 0o700);
    for (const entry of yield* fs.readDirectory(path)) yield* removeTree(join(path, entry));
    yield* removeEmptyDirectory(path);
  });

type ExternalStatus = "external installed" | "external differs" | "unmanaged";
type External = { status: ExternalStatus; differences?: BundleDifference[] };
type Source = { path: string; bundle: Bundle; copyStatus: (digest: string) => Effect.Effect<ExternalStatus, StorageFailure, FileSystem.FileSystem> };

const externalInstall = (path: string, name: string, source: Source, guard: Guard) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const stat = yield* info(path);
    if (stat?.type === "SymbolicLink") {
      const external: External = { status: (yield* fs.realPath(path)) === source.path ? "external installed" : "unmanaged" };
      return external;
    }
    if (stat?.type !== "Directory") return { status: "unmanaged" } satisfies External;
    const document = yield* markdown(path, guard, name);
    const copy = yield* readBundle(path, guard);
    const status: ExternalStatus = document.content === copy.content ? yield* source.copyStatus(copy.digest) : "unmanaged";
    const external: External = status === "external differs" ? { status, differences: installedBundleDifferences(copy, source.bundle) } : { status };
    return external;
  }).pipe(Effect.catch(() => Effect.succeed<External>({ status: "unmanaged" })));

const loadRecord = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, path: string, guard: Guard) =>
  Effect.gen(function* () {
    yield* guard(path);
    if ((yield* info(path)) === undefined) return null;
    const { bytes } = yield* readRegular(path, 128 * 1024);
    const value = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(bytes.toString("utf8"));
    return yield* Schema.decodeUnknownEffect(schema)(value);
  }).pipe(Effect.mapError(() => conflict("The destination management record is unreadable.")));

const openInstallation = Effect.fnUntraced(function* (dataDir: string, destination: PhysicalDestination, name: string, skillPath: string, guard: Guard) {
  const fs = yield* FileSystem.FileSystem;
  const path = join(destination.path, name);
  const folder = installStateFolder(dataDir, destination.path, name);
  const record = join(folder, "state.json");
  const journal = join(folder, "pending.json");
  const installs = join(dataDir, "skill-installs");
  for (const directory of [destination.path, installs, join(installs, sha256(Buffer.from(destination.path))), folder]) {
    yield* checkDirectory(directory, guard);
  }
  for (const file of [path, record, journal]) yield* guard(file);

  const openWorkspace = Effect.fnUntraced(function* (id: string) {
    const root = join(destination.path, ".wiki-agents-stage-" + id);
    yield* checkDirectory(root, guard);
    return { root, moved: join(root, "old"), staged: join(root, "stage") };
  });

  const read = Effect.fnUntraced(function* (location: string) {
    return (yield* info(location)) === undefined ? null : yield* readBundle(location, guard);
  });

  const holds = (location: string, digest: string | null) =>
    read(location).pipe(
      Effect.map((bundle) => (bundle?.digest ?? null) === digest),
      Effect.catchIf(isSkillProblem, () => Effect.succeed(false)),
    );

  const requireOwner = (state: State | null, pending: Journal) => {
    const owner = state !== null && state.current !== null ? state.skillPath : pending.next.skillPath;
    return owner === skillPath ? Effect.void : Effect.fail(conflict(`This destination name is managed for ${owner}.`));
  };

  const load = Effect.gen(function* () {
    const state: State | null = yield* loadRecord(State, record, guard);
    const pending: Journal | null = yield* loadRecord(Journal, journal, guard);
    if (pending !== null) yield* requireOwner(state, pending);
    return { state, pending };
  });

  const inspect = Effect.map(load, ({ state, pending }) => ({ state, interrupted: pending !== null }));

  const activated = Effect.fnUntraced(function* ({ next, workspace, before }: Journal) {
    const { root, moved, staged } = yield* openWorkspace(workspace);
    return (yield* info(root)) !== undefined &&
      (yield* info(staged)) === undefined &&
      (yield* holds(moved, before)) &&
      (yield* holds(path, next.current));
  });

  const reconcile = Effect.gen(function* () {
    const { state, pending } = yield* load;
    if (pending === null) return;
    const { root, moved } = yield* openWorkspace(pending.workspace);
    if (state?.transaction !== pending.workspace) {
      if (yield* activated(pending)) yield* writeAtomic(record, JSON.stringify(pending.next));
      else if (yield* info(moved)) {
        if (yield* info(path)) return yield* conflict("The interrupted install has conflicting files. Inspect the destination before retrying.");
        yield* fs.rename(moved, path);
      }
    }
    yield* removeTree(root);
    yield* fs.remove(journal);
  });

  const live = (state: State | null) =>
    state === null || state.current === null
      ? Effect.succeed(null)
      : read(path).pipe(Effect.catchIf(isSkillProblem, () => Effect.succeed(null)));

  const snapshot = Effect.fnUntraced(function* (digest: string) {
    const bundle = yield* read(join(folder, digest));
    if (bundle?.digest !== digest) return yield* conflict("The rollback snapshot is missing or has changed.");
    return bundle;
  });

  const keepSnapshot = Effect.fnUntraced(function* (bundle: Bundle) {
    const target = join(folder, bundle.digest);
    if (yield* info(target)) {
      yield* snapshot(bundle.digest);
      return;
    }
    yield* Effect.acquireUseRelease(
      fs.makeTempDirectory({ directory: folder, prefix: "copy-" }),
      (temp) =>
        Effect.gen(function* () {
          yield* writeBundle(temp, bundle, guard);
          if ((yield* readBundle(temp, guard)).digest !== bundle.digest) return yield* conflict("The rollback snapshot failed verification.");
          yield* fs.rename(temp, target);
        }),
      removeTree,
    );
  });

  const discardSnapshot = (digest: string) =>
    snapshot(digest).pipe(Effect.andThen(removeTree(join(folder, digest))), Effect.ignore);

  const activate = Effect.fnUntraced(function* (state: State | null, next: Bundle | null, current: Bundle | null) {
    const latest = yield* inspect;
    if (latest.interrupted || latest.state?.transaction !== state?.transaction) {
      return yield* conflict("The install changed since review. Review it again.");
    }
    yield* fs.makeDirectory(folder, { recursive: true, mode: 0o700 });
    yield* fs.makeDirectory(destination.path, { recursive: true });
    if (current !== null) yield* keepSnapshot(current);

    const workspace = randomUUID();
    const { root, moved, staged } = yield* openWorkspace(workspace);
    const before = current?.digest ?? null;
    const updated: State = { current: next?.digest ?? null, previous: before, skillPath, transaction: workspace };
    yield* writeAtomic(journal, JSON.stringify({ next: updated, workspace, before }));
    yield* Effect.gen(function* () {
      yield* fs.makeDirectory(root, { mode: 0o700 });
      if (next !== null) {
        yield* fs.makeDirectory(staged, { mode: 0o700 });
        yield* writeBundle(staged, next, guard);
        if (!(yield* holds(staged, next.digest))) return yield* conflict("The staged bundle failed verification.");
      }
      if (!(yield* holds(path, before))) return yield* conflict("The destination changed since review.");
      if (current !== null) {
        yield* fs.rename(path, moved);
        if (!(yield* holds(moved, before))) return yield* conflict("The destination changed as it was moved. The replacement was not published.");
      }
      if (next !== null) {
        if (yield* info(path)) return yield* conflict("The destination was created concurrently.");
        yield* fs.rename(staged, path);
      }
    }).pipe(Effect.catchCause((cause) => Effect.andThen(reconcile, Effect.failCause(cause))));
    yield* reconcile;
    const obsolete = state?.previous ?? null;
    if (obsolete !== null && obsolete !== updated.previous) yield* discardSnapshot(obsolete);
  });

  const target = Effect.fnUntraced(function* (state: State | null, installed: Bundle | null, source: Source) {
    const exists = (yield* info(path)) !== undefined;
    const owner = state?.skillPath;
    const current = state?.current ?? null;
    if (current !== null && owner !== skillPath) {
      return {
        destination,
        path,
        status: "conflict",
        actions: [],
        problem: `This destination name is managed for ${owner}. Remove that install before installing this skill.`,
      } satisfies InstallTarget;
    }
    if (current === null && exists) {
      return { destination, path, actions: [], ...(yield* externalInstall(path, name, source, guard)) } satisfies InstallTarget;
    }
    const status = current === null
      ? "absent"
      : !exists ? "missing"
      : current !== installed?.digest ? "modified"
      : source.bundle.digest === installed.digest ? "installed" : "update available";
    const actions: InstallAction[] = [];
    if (status === "absent" || status === "missing") actions.push("install");
    if (status === "update available") actions.push("update");
    if (status === "installed" || status === "update available") actions.push("remove");
    if (owner === skillPath && state?.previous != null && ["installed", "update available", "absent"].includes(status)) actions.push("rollback");
    return { destination, path, status, actions } satisfies InstallTarget;
  });

  return { path, inspect, reconcile, live, snapshot, activate, target };
});

const interruptedProblem = "An interrupted install needs recovery.";

export const installTarget = Effect.fnUntraced(function* (dataDir: string, destination: PhysicalDestination, name: string, skillPath: string, source: Source, guard: Guard) {
  const install = yield* openInstallation(dataDir, destination, name, skillPath, guard);
  const { state, interrupted } = yield* install.inspect;
  const target: InstallTarget = interrupted
    ? { destination, path: install.path, status: "conflict", actions: [], problem: interruptedProblem, needsRecovery: true }
    : yield* install.target(state, yield* install.live(state), source);
  return target;
});

export const installPlan = Effect.fnUntraced(function* (
  dataDir: string,
  destination: PhysicalDestination,
  name: string,
  skillPath: string,
  action: InstallAction,
  source: Source,
  guard: Guard,
) {
  const install = yield* openInstallation(dataDir, destination, name, skillPath, guard);
  const { state, interrupted } = yield* install.inspect;
  if (interrupted) return yield* conflict(interruptedProblem);
  const before = yield* install.live(state);
  const target: InstallTarget = yield* install.target(state, before, source);
  if (!target.actions.includes(action)) return yield* conflict(target.problem ?? `Cannot ${action}: destination status is ${target.status}.`);
  const after = action === "remove" ? null : action === "rollback" ? yield* install.snapshot(state!.previous!) : source.bundle;
  const review: Review = {
    path: install.path,
    token: sha256(Buffer.from(JSON.stringify([install.path, skillPath, action, state, before?.digest, after?.digest]))),
    before: before?.content ?? "",
    after: after?.content ?? "",
    files: bundleChanges(before, after),
  };
  return { review, apply: install.activate(state, after, before) };
});

export const recoverInstall = Effect.fnUntraced(function* (dataDir: string, destination: PhysicalDestination, name: string, skillPath: string, guard: Guard) {
  const install = yield* openInstallation(dataDir, destination, name, skillPath, guard);
  yield* install.reconcile;
});
