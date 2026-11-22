import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, lstatSync, openSync, mkdirSync, mkdtempSync, realpathSync, readdirSync, renameSync, rmdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import type { BundleDifference, InstallAction, InstallTarget, PhysicalDestination, Review } from "@wiki-agents/contracts/skills/model";
import { sha256 } from "../../shared/config-files.js";
import { bundleChanges, type Bundle, type Guard, info, installedBundleDifferences, markdown, readBundle, writeBundle } from "./bundle.js";
import { SkillProblem } from "./problem.js";
import { readJson, writeAtomic } from "./state-file.js";

const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Version = Schema.NullOr(Digest);
const State = Schema.Struct({ current: Version, previous: Version, skillPath: Schema.optional(Schema.String), transaction: Schema.optional(Schema.String) });
const Journal = Schema.Struct({ old: State, next: State });
const WorkspaceId = Schema.String.check(Schema.isPattern(/^[a-f0-9-]{36}$/));
const LocalJournal = Schema.Struct({ ...Journal.fields, workspace: WorkspaceId, before: Version, stagedIdentity: Schema.optional(Schema.String), stagedArtifactIdentity: Schema.optional(Schema.String), workspaceIdentity: Schema.optional(Schema.String), oldIdentity: Schema.optional(Schema.String) });
type State = typeof State.Type;
type Journal = typeof Journal.Type;
function directoryIdentity(path: string) {
  try {
    const stat = lstatSync(path, { bigint: true });
    return stat.isDirectory() ? stat.dev.toString() + ":" + stat.ino.toString() : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

class PlacementConflict extends SkillProblem {}

function renameNoReplace(from: string, to: string) {
  const helper = process.env["WIKI_AGENTS_ATOMIC_RENAME"] ?? "wiki-agents-rename-noreplace";
  const result = spawnSync(helper, [from, to], { encoding: "utf8" });
  if (result.status === 0) return;
  if (result.status === 3) throw new PlacementConflict("The destination was created concurrently. Recovery files were preserved.", 409);
  throw new PlacementConflict("Atomic placement is unavailable for this destination. Recovery files were preserved.", 409);
}

const emptyState: State = { current: null, previous: null };

export function installStateFolder(dataDir: string, destination: string, name: string) {
  return join(dataDir, "skill-installs", sha256(Buffer.from(destination)), name);
}

function checkDirectory(path: string, guard: Guard) {
  guard(path);
  const stat = info(path);
  if (stat && !stat.isDirectory()) throw new SkillProblem("The destination or its management directory is unsafe.", 409);
}

function removeEmpty(path: string) {
  try {
    rmdirSync(path);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
  }
}
function removeRetired(path: string, guard: Guard) {
  guard(path);
  const stat = info(path);
  if (!stat) return;
  if (!stat.isDirectory()) {
    rmSync(path);
    return;
  }
  if ((stat.mode & 0o700) !== 0o700) {
    const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      fchmodSync(fd, (fstatSync(fd).mode & 0o777) | 0o700);
    } finally {
      closeSync(fd);
    }
  }
  for (const entry of readdirSync(path)) removeRetired(join(path, entry), guard);
  rmdirSync(path);
}

type ExternalStatus = "external installed" | "external differs" | "unmanaged";
type Source = { path: string; bundle: Bundle; copyStatus: (digest: string) => ExternalStatus };

function externalInstall(path: string, name: string, source: Source, guard: Guard): { status: ExternalStatus; differences?: BundleDifference[] } {
  try {
    const stat = info(path);
    if (stat?.isSymbolicLink()) {
      return { status: realpathSync(path) === source.path ? "external installed" : "unmanaged" };
    }
    if (!stat?.isDirectory()) return { status: "unmanaged" };
    const document = markdown(path, guard, name);
    const copy = readBundle(path, guard);
    const status = document.content === copy.content ? source.copyStatus(copy.digest) : "unmanaged";
    return status === "external differs"
      ? { status, differences: installedBundleDifferences(copy, source.bundle) }
      : { status };
  } catch {
    return { status: "unmanaged" };
  }
}

class Installation {
  readonly path: string;
  readonly folder: string;
  readonly record: string;
  readonly journal: string;
  readonly legacyRoot: string;
  readonly legacy: string;

  constructor(dataDir: string, readonly destination: PhysicalDestination, readonly name: string, readonly skillPath: string, readonly guard: Guard, readonly moveLive: typeof renameSync = renameSync, readonly beforePlacement?: (from: string, to: string) => void) {
    this.path = join(destination.path, name);
    this.folder = installStateFolder(dataDir, destination.path, name);
    this.record = join(this.folder, "state.json");
    this.journal = join(this.folder, "pending.json");
    this.legacyRoot = join(destination.path, ".wiki-agents-skills");
    this.legacy = join(this.legacyRoot, name);
    for (const directory of [destination.path, join(dataDir, "skill-installs"), join(dataDir, "skill-installs", sha256(Buffer.from(destination.path))), this.folder]) {
      checkDirectory(directory, guard);
    }
    for (const file of [this.path, this.record, this.journal]) guard(file);
  }

  private workspace(id: string) {
    const root = join(this.destination.path, ".wiki-agents-stage-" + id);
    checkDirectory(root, this.guard);
    return { root, moved: join(root, "old"), staged: join(root, "stage") };
  }

  private read(path: string) {
    return info(path) ? readBundle(path, this.guard) : null;
  }

  private checkPlacementSupport(root: string) {
    const from = join(root, "probe");
    const to = join(root, "probe-renamed");
    mkdirSync(from);
    try {
      renameNoReplace(from, to);
    } finally {
      removeEmpty(from);
      removeEmpty(to);
    }
  }

  private placeLive(from: string) {
    this.beforePlacement?.(from, this.path);
    renameNoReplace(from, this.path);
  }

  private recoveryOwner(state: State | null, pending: Journal | null) {
    if (state?.current && (state.skillPath ?? this.name) !== this.skillPath) return state.skillPath ?? this.name;
    return pending ? pending.next.skillPath ?? this.name : state?.skillPath ?? this.name;
  }

  private requireOwner(state: State | null, pending: Journal | null, legacy = false) {
    const owner = legacy && state && !state.skillPath ? this.name : this.recoveryOwner(state, pending);
    if (owner !== this.skillPath) throw new SkillProblem(`This destination name is managed for ${owner}.`, 409);
  }

  inspect() {
    const state = this.load(State, this.record);
    const pending = this.load(LocalJournal, this.journal);
    if (pending) {
      this.requireOwner(state, pending);
      return { state, problem: "An interrupted install needs recovery." };
    }
    if (state) return { state };
    checkDirectory(this.legacyRoot, this.guard);
    checkDirectory(this.legacy, this.guard);
    const legacy = this.load(State, join(this.legacy, "state.json"));
    const legacyPending = this.load(Journal, join(this.legacy, "pending.json"));
    if (legacy || legacyPending) {
      this.requireOwner(legacy, legacyPending, true);
      return { state, problem: "Legacy install records need migration." };
    }
    return { state: emptyState };
  }

  reconcile(): State {
    const state = this.load(State, this.record);
    const pending = this.load(LocalJournal, this.journal);
    if (!pending) {
      if (!state) return this.migrate();
      this.requireOwner(state, null);
      return state;
    }
    this.requireOwner(state, pending);
    const transactionMatches = pending.next.transaction === pending.workspace;
    const committed = state?.transaction === pending.workspace;
    if (committed) {
      if (!transactionMatches || state.current !== pending.next.current || state.previous !== pending.next.previous ||
          state.skillPath !== pending.next.skillPath) throw this.recoveryConflict();
      if (state.previous !== null) this.snapshot(state.previous);
      if (!pending.workspaceIdentity && !pending.oldIdentity) {
        rmSync(this.journal);
        return state;
      }
    }
    const { root, moved, staged } = this.workspace(pending.workspace);
    const cleanup = () => {
      if (info(root) && (!pending.workspaceIdentity || directoryIdentity(root) !== pending.workspaceIdentity)) throw this.recoveryConflict();
      if (info(moved) && (!pending.oldIdentity || directoryIdentity(moved) !== pending.oldIdentity)) throw this.recoveryConflict();
      const stageIdentity = pending.stagedIdentity ?? pending.stagedArtifactIdentity;
      if (info(staged) && (!stageIdentity || directoryIdentity(staged) !== stageIdentity)) throw this.recoveryConflict();
      removeRetired(moved, this.guard);
      removeRetired(staged, this.guard);
      removeEmpty(root);
      rmSync(this.journal);
    };
    if (committed) {
      cleanup();
      return state;
    }
    if (info(root) && (!pending.workspaceIdentity || directoryIdentity(root) !== pending.workspaceIdentity)) throw this.recoveryConflict();
    const liveMatches = pending.next.current === null
      ? !info(this.path)
      : pending.stagedIdentity !== undefined &&
        directoryIdentity(this.path) === pending.stagedIdentity &&
        this.read(this.path)?.digest === pending.next.current &&
        directoryIdentity(this.path) === pending.stagedIdentity;
    const movedExists = info(moved) !== undefined;
    let old: Bundle | null = null;
    if (movedExists) {
      if (!pending.workspaceIdentity || !pending.oldIdentity || directoryIdentity(moved) !== pending.oldIdentity) throw this.recoveryConflict();
      try {
        old = this.read(moved);
      } catch {
        if (info(this.path)) throw this.recoveryConflict();
      }
    }
    const proven = pending.next.current === null ? liveMatches && old !== null : liveMatches;
    if (transactionMatches && proven && (pending.before === null ? old === null : old?.digest === pending.before)) {
      if (pending.next.previous !== null) {
        if (old?.digest === pending.next.previous) this.keepSnapshot(old);
        else this.snapshot(pending.next.previous);
      }
      writeAtomic(this.record, JSON.stringify(pending.next));
      cleanup();
      return pending.next;
    }
    if (movedExists) {
      if (info(this.path) || directoryIdentity(moved) !== pending.oldIdentity) throw this.recoveryConflict();
      this.placeLive(moved);
    } else if ((pending.before !== null && !info(this.path)) || (pending.before === null && state?.current && info(this.path))) {
      throw this.recoveryConflict();
    }
    cleanup();
    return state ?? emptyState;
  }

  private recoveryConflict() {
    return new SkillProblem("The interrupted install has conflicting files. Inspect the destination before retrying.", 409);
  }

  private recoverLegacy(state: State | null, pending: Journal, record: string, journal: string) {
    const moved = join(this.legacy, "old");
    if (state !== null && state.current === pending.next.current && state.previous === pending.next.previous &&
        state.skillPath === pending.next.skillPath && this.read(this.path)?.digest === (pending.next.current ?? undefined)) {
      if (state.previous !== null) this.verifiedSnapshot(this.legacy, state.previous);
    } else if (info(moved) || (this.read(this.path)?.digest ?? null) !== pending.old.current) {
      throw this.recoveryConflict();
    }
    rmSync(journal);
    return this.load(State, record) ?? pending.old;
  }

  private migrate(): State {
    checkDirectory(this.legacyRoot, this.guard);
    checkDirectory(this.legacy, this.guard);
    const record = join(this.legacy, "state.json");
    const journal = join(this.legacy, "pending.json");
    const stored = this.load(State, record);
    const pending = this.load(Journal, journal);
    if (stored === null && pending === null) return emptyState;
    this.requireOwner(stored, pending, true);
    if (!pending && info(join(this.legacy, "old"))) throw new SkillProblem("A legacy install requires recovery before it can be migrated.", 409);
    const state = pending === null ? stored! : this.recoverLegacy(stored, pending, record, journal);
    const snapshot = state.previous === null ? null : this.verifiedSnapshot(this.legacy, state.previous);
    mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    if (snapshot !== null) this.keepSnapshot(snapshot);
    writeAtomic(this.record, JSON.stringify(state));
    for (const name of readdirSync(this.legacy)) {
      if (!/^[a-f0-9]{64}$/.test(name)) continue;
      const path = join(this.legacy, name);
      let verified = false;
      try {
        verified = this.read(path)?.digest === name;
      } catch {
        continue;
      }
      if (verified) removeRetired(path, this.guard);
    }
    rmSync(record, { force: true });
    removeEmpty(this.legacy);
    removeEmpty(this.legacyRoot);
    return state;
  }

  private load<S extends Schema.ConstraintDecoder<unknown>>(schema: S, path: string): S["Type"] | null {
    try {
      this.guard(path);
      const value = readJson(path);
      if (value === null && !info(path)) return null;
      return Schema.decodeUnknownSync(schema)(value);
    } catch {
      throw new SkillProblem("The destination management record is unreadable.", 409);
    }
  }

  live(state: State) {
    if (state.current === null) return null;
    try {
      return this.read(this.path);
    } catch (error) {
      if (!(error instanceof SkillProblem)) throw error;
      return null;
    }
  }

  snapshot(digest: string) {
    return this.verifiedSnapshot(this.folder, digest);
  }

  private verifiedSnapshot(folder: string, digest: string) {
    const bundle = this.read(join(folder, digest));
    if (bundle?.digest !== digest) throw new SkillProblem("The rollback snapshot is missing or has changed.", 409);
    return bundle;
  }

  private keepSnapshot(bundle: Bundle) {
    const snapshot = join(this.folder, bundle.digest);
    if (info(snapshot)) {
      this.snapshot(bundle.digest);
      return;
    }
    const temp = mkdtempSync(join(this.folder, "copy-"));
    try {
      writeBundle(temp, bundle, this.guard);
      if (readBundle(temp, this.guard).digest !== bundle.digest) throw new SkillProblem("The rollback snapshot failed verification.", 409);
      renameSync(temp, snapshot);
    } finally {
      removeRetired(temp, this.guard);
    }
  }

  activate(state: State, next: Bundle | null, current: Bundle | null) {
    mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    mkdirSync(this.destination.path, { recursive: true });
    if (current !== null) this.keepSnapshot(current);

    const workspace = randomUUID();
    const { root, moved, staged } = this.workspace(workspace);
    if (info(root)) throw new SkillProblem("The install staging path is already occupied.", 409);
    const updated = { current: next?.digest ?? null, previous: current?.digest ?? null, skillPath: this.skillPath, transaction: workspace };
    const pending = { old: state, next: updated, workspace, before: current?.digest ?? null };
    writeAtomic(this.journal, JSON.stringify(pending));
    let created = false;
    let verifiedIdentity: string | null = null;
    let oldIdentity: string | null = null;
    try {
      mkdirSync(root, { mode: 0o700 });
      created = true;
      const workspaceIdentity = directoryIdentity(root);
      if (!workspaceIdentity) throw this.recoveryConflict();
      oldIdentity = current === null ? null : directoryIdentity(this.path);
      const identities = { workspaceIdentity, ...(oldIdentity === null ? {} : { oldIdentity }) };
      writeAtomic(this.journal, JSON.stringify({ ...pending, ...identities }));
      if (next !== null) {
        mkdirSync(staged, { mode: 0o700 });
        const identity = directoryIdentity(staged);
        if (identity === null) throw this.recoveryConflict();
        writeAtomic(this.journal, JSON.stringify({ ...pending, ...identities, stagedArtifactIdentity: identity }));
        writeBundle(staged, next, this.guard);
        if (this.read(staged)?.digest !== next.digest || directoryIdentity(staged) !== identity) {
          throw new SkillProblem("The staged bundle failed verification.", 409);
        }
        verifiedIdentity = identity;
        writeAtomic(this.journal, JSON.stringify({ ...pending, ...identities, stagedIdentity: identity }));
      }
      if (current !== null) this.checkPlacementSupport(root);
      if (current === null ? info(this.path) !== undefined : this.read(this.path)?.digest !== current.digest) {
        throw new SkillProblem("The destination changed since review.", 409);
      }
    } catch (error) {
      if (created) {
        removeRetired(staged, this.guard);
        removeEmpty(root);
      }
      rmSync(this.journal);
      throw error;
    }
    try {
      if (current !== null) {
        this.moveLive(this.path, moved);
        if (directoryIdentity(moved) !== oldIdentity || this.read(moved)?.digest !== current.digest) {
          throw new SkillProblem("The destination changed as it was moved. The replacement was not published.", 409);
        }
      }
      if (next !== null) {
        if (directoryIdentity(staged) !== verifiedIdentity) throw new PlacementConflict("Staged bundle changed. Recovery files were preserved.", 409);
        this.placeLive(staged);
      }
    } catch (error) {
      if (error instanceof PlacementConflict) throw error;
      this.reconcile();
      throw error;
    }
    this.reconcile();
    if (state.previous !== null && state.previous !== updated.previous) {
      try {
        this.snapshot(state.previous);
        removeRetired(join(this.folder, state.previous), this.guard);
      } catch {
        return;
      }
    }
  }

  target(state: State, live: Bundle | null, source: Source): InstallTarget {
    const exists = info(this.path) !== undefined;
    const owner = state.skillPath ?? this.name;
    if (state.current !== null && owner !== this.skillPath) {
      return {
        destination: this.destination,
        path: this.path,
        status: "conflict",
        actions: [],
        problem: `This destination name is managed for ${owner}. Remove that install before installing this skill.`,
      };
    }
    if (state.current === null && exists) {
      return { destination: this.destination, path: this.path, actions: [], ...externalInstall(this.path, this.name, source, this.guard) };
    }
    const status = state.current === null
      ? "absent"
      : !exists ? "missing"
      : state.current !== live?.digest ? "modified"
      : source.bundle.digest === live.digest ? "installed" : "update available";
    const actions: InstallAction[] = [];
    if (status === "absent" || status === "missing") actions.push("install");
    if (status === "update available") actions.push("update");
    if (status === "installed" || status === "update available") actions.push("remove");
    if (owner === this.skillPath && state.previous !== null && ["installed", "update available", "absent"].includes(status)) actions.push("rollback");
    return { destination: this.destination, path: this.path, status, actions };
  }
}

export function installTarget(dataDir: string, destination: PhysicalDestination, name: string, skillPath: string, source: Source, guard: Guard) {
  const install = new Installation(dataDir, destination, name, skillPath, guard);
  const { state, problem } = install.inspect();
  if (problem || state === null) {
    return { destination, path: install.path, status: "conflict" as const, actions: [], problem: problem ?? "Install requires recovery.", needsRecovery: true };
  }
  return install.target(state, install.live(state), source);
}

export function installPlan(dataDir: string, destination: PhysicalDestination, name: string, skillPath: string, action: InstallAction, source: Source, guard: Guard, moveLive?: typeof renameSync, beforePlacement?: (from: string, to: string) => void) {
  const install = new Installation(dataDir, destination, name, skillPath, guard, moveLive, beforePlacement);
  const { state, problem } = install.inspect();
  if (!state || problem) throw new SkillProblem(problem ?? "Install requires recovery.", 409);
  const before = install.live(state);
  const target = install.target(state, before, source);
  if (!target.actions.includes(action)) throw new SkillProblem(target.problem ?? `Cannot ${action}: destination status is ${target.status}.`, 409);
  const after = action === "remove" ? null : action === "rollback" ? install.snapshot(state.previous!) : source.bundle;
  const review: Review = {
    path: install.path,
    token: sha256(Buffer.from(JSON.stringify([install.path, skillPath, action, state, before?.digest, after?.digest]))),
    before: before?.content ?? "",
    after: after?.content ?? "",
    files: bundleChanges(before, after),
  };
  return { review, apply: () => install.activate(state, after, before) };
}

export function recoverInstall(dataDir: string, destination: PhysicalDestination, name: string, skillPath: string, guard: Guard, beforePlacement?: (from: string, to: string) => void) {
  new Installation(dataDir, destination, name, skillPath, guard, undefined, beforePlacement).reconcile();
}
