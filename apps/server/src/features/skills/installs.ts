import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import type { BundleDifference, InstallAction, InstallTarget, PhysicalDestination, Review } from "@wiki-agents/contracts/skills/model";
import { sha256 } from "../../shared/config-files.js";
import { bundleChanges, type Bundle, type Guard, info, installedBundleDifferences, markdown, readBundle, writeBundle } from "./bundle.js";
import { SkillConflict, isSkillProblem } from "./errors.js";
import { readJson, writeAtomic } from "./state-file.js";

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

function checkDirectory(path: string, guard: Guard) {
  guard(path);
  const stat = info(path);
  if (stat && !stat.isDirectory()) throw new SkillConflict({ message: "The destination or its management directory is unsafe." });
}

function removeTree(path: string) {
  const stat = info(path);
  if (!stat) return;
  if (!stat.isDirectory()) {
    rmSync(path);
    return;
  }
  if ((stat.mode & 0o700) !== 0o700) chmodSync(path, (stat.mode & 0o777) | 0o700);
  for (const entry of readdirSync(path)) removeTree(join(path, entry));
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

  constructor(dataDir: string, readonly destination: PhysicalDestination, readonly name: string, readonly skillPath: string, readonly guard: Guard) {
    this.path = join(destination.path, name);
    this.folder = installStateFolder(dataDir, destination.path, name);
    this.record = join(this.folder, "state.json");
    this.journal = join(this.folder, "pending.json");
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

  private holds(path: string, digest: string | null) {
    try {
      return (this.read(path)?.digest ?? null) === digest;
    } catch (error) {
      if (!isSkillProblem(error)) throw error;
      return false;
    }
  }

  private requireOwner(state: State | null, pending: Journal) {
    const owner = state !== null && state.current !== null ? state.skillPath : pending.next.skillPath;
    if (owner !== this.skillPath) throw new SkillConflict({ message: `This destination name is managed for ${owner}.` });
  }

  inspect() {
    const state = this.load(State, this.record);
    const pending = this.load(Journal, this.journal);
    if (pending) this.requireOwner(state, pending);
    return { state, interrupted: pending !== null };
  }

  reconcile() {
    const state = this.load(State, this.record);
    const pending = this.load(Journal, this.journal);
    if (!pending) return;
    this.requireOwner(state, pending);
    const { root, moved } = this.workspace(pending.workspace);
    if (state?.transaction !== pending.workspace) {
      if (this.activated(pending)) writeAtomic(this.record, JSON.stringify(pending.next));
      else if (info(moved)) {
        if (info(this.path)) throw new SkillConflict({ message: "The interrupted install has conflicting files. Inspect the destination before retrying." });
        renameSync(moved, this.path);
      }
    }
    removeTree(root);
    rmSync(this.journal);
  }

  private activated({ next, workspace, before }: Journal) {
    const { root, moved, staged } = this.workspace(workspace);
    return info(root) !== undefined && info(staged) === undefined && this.holds(moved, before) && this.holds(this.path, next.current);
  }

  private load<S extends Schema.ConstraintDecoder<unknown>>(schema: S, path: string): S["Type"] | null {
    try {
      this.guard(path);
      const value = readJson(path);
      if (value === null && !info(path)) return null;
      return Schema.decodeUnknownSync(schema)(value);
    } catch {
      throw new SkillConflict({ message: "The destination management record is unreadable." });
    }
  }

  live(state: State | null) {
    if (state === null || state.current === null) return null;
    try {
      return this.read(this.path);
    } catch (error) {
      if (!isSkillProblem(error)) throw error;
      return null;
    }
  }

  snapshot(digest: string) {
    const bundle = this.read(join(this.folder, digest));
    if (bundle?.digest !== digest) throw new SkillConflict({ message: "The rollback snapshot is missing or has changed." });
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
      if (readBundle(temp, this.guard).digest !== bundle.digest) throw new SkillConflict({ message: "The rollback snapshot failed verification." });
      renameSync(temp, snapshot);
    } finally {
      removeTree(temp);
    }
  }

  activate(state: State | null, next: Bundle | null, current: Bundle | null) {
    const latest = this.inspect();
    if (latest.interrupted || latest.state?.transaction !== state?.transaction) {
      throw new SkillConflict({ message: "The install changed since review. Review it again." });
    }
    mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    mkdirSync(this.destination.path, { recursive: true });
    if (current !== null) this.keepSnapshot(current);

    const workspace = randomUUID();
    const { root, moved, staged } = this.workspace(workspace);
    const before = current?.digest ?? null;
    const updated: State = { current: next?.digest ?? null, previous: before, skillPath: this.skillPath, transaction: workspace };
    writeAtomic(this.journal, JSON.stringify({ next: updated, workspace, before }));
    try {
      mkdirSync(root, { mode: 0o700 });
      if (next !== null) {
        mkdirSync(staged, { mode: 0o700 });
        writeBundle(staged, next, this.guard);
        if (!this.holds(staged, next.digest)) throw new SkillConflict({ message: "The staged bundle failed verification." });
      }
      if (!this.holds(this.path, before)) throw new SkillConflict({ message: "The destination changed since review." });
      if (current !== null) {
        renameSync(this.path, moved);
        if (!this.holds(moved, before)) throw new SkillConflict({ message: "The destination changed as it was moved. The replacement was not published." });
      }
      if (next !== null) {
        if (info(this.path)) throw new SkillConflict({ message: "The destination was created concurrently." });
        renameSync(staged, this.path);
      }
    } catch (error) {
      this.reconcile();
      throw error;
    }
    this.reconcile();
    const obsolete = state?.previous ?? null;
    if (obsolete !== null && obsolete !== updated.previous) this.discardSnapshot(obsolete);
  }

  private discardSnapshot(digest: string) {
    try {
      this.snapshot(digest);
      removeTree(join(this.folder, digest));
    } catch {
      return;
    }
  }

  target(state: State | null, live: Bundle | null, source: Source): InstallTarget {
    const exists = info(this.path) !== undefined;
    const owner = state?.skillPath;
    const current = state?.current ?? null;
    if (current !== null && owner !== this.skillPath) {
      return {
        destination: this.destination,
        path: this.path,
        status: "conflict",
        actions: [],
        problem: `This destination name is managed for ${owner}. Remove that install before installing this skill.`,
      };
    }
    if (current === null && exists) {
      return { destination: this.destination, path: this.path, actions: [], ...externalInstall(this.path, this.name, source, this.guard) };
    }
    const status = current === null
      ? "absent"
      : !exists ? "missing"
      : current !== live?.digest ? "modified"
      : source.bundle.digest === live.digest ? "installed" : "update available";
    const actions: InstallAction[] = [];
    if (status === "absent" || status === "missing") actions.push("install");
    if (status === "update available") actions.push("update");
    if (status === "installed" || status === "update available") actions.push("remove");
    if (owner === this.skillPath && state?.previous != null && ["installed", "update available", "absent"].includes(status)) actions.push("rollback");
    return { destination: this.destination, path: this.path, status, actions };
  }
}

const interruptedProblem = "An interrupted install needs recovery.";

export function installTarget(dataDir: string, destination: PhysicalDestination, name: string, skillPath: string, source: Source, guard: Guard) {
  const install = new Installation(dataDir, destination, name, skillPath, guard);
  const { state, interrupted } = install.inspect();
  if (interrupted) {
    return { destination, path: install.path, status: "conflict" as const, actions: [], problem: interruptedProblem, needsRecovery: true };
  }
  return install.target(state, install.live(state), source);
}

export function installPlan(dataDir: string, destination: PhysicalDestination, name: string, skillPath: string, action: InstallAction, source: Source, guard: Guard) {
  const install = new Installation(dataDir, destination, name, skillPath, guard);
  const { state, interrupted } = install.inspect();
  if (interrupted) throw new SkillConflict({ message: interruptedProblem });
  const before = install.live(state);
  const target = install.target(state, before, source);
  if (!target.actions.includes(action)) throw new SkillConflict({ message: target.problem ?? `Cannot ${action}: destination status is ${target.status}.` });
  const after = action === "remove" ? null : action === "rollback" ? install.snapshot(state!.previous!) : source.bundle;
  const review: Review = {
    path: install.path,
    token: sha256(Buffer.from(JSON.stringify([install.path, skillPath, action, state, before?.digest, after?.digest]))),
    before: before?.content ?? "",
    after: after?.content ?? "",
    files: bundleChanges(before, after),
  };
  return { review, apply: () => install.activate(state, after, before) };
}

export function recoverInstall(dataDir: string, destination: PhysicalDestination, name: string, skillPath: string, guard: Guard) {
  new Installation(dataDir, destination, name, skillPath, guard).reconcile();
}
