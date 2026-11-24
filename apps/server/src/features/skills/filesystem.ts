import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type Catalog, type Detail, type Settings as SkillSettings, Settings } from "@wiki-agents/contracts/skills/model";
import { Effect, Layer, Schema } from "effect";
import { sha256 } from "../../shared/config-files.js";
import { AppConfig } from "../../shared/config.js";
import { type Protection } from "../../shared/secret-paths.js";
import { SecretMaterial } from "../secrets/material.js";
import { info, markdown, MAX_MARKDOWN_BYTES, metadata, readBundle, readRegular, writeBundle } from "./bundle.js";
import { installPlan, installTarget, recoverInstall } from "./installs.js";
import { configuredPath, disjoint, librarySkill, pathGuard, physicalDestinations, previewPaths } from "./paths.js";
import { isSkillProblem, SkillConflict, type SkillError, SkillInvalid, SkillNotFound, SkillStorageError } from "./errors.js";
import { Skills } from "./repository.js";
import { writeAtomic } from "./state-file.js";

type Options = { configDir: string; dataDir: string; home: string };
function claimDirectory(path: string) {
  try {
    mkdirSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new SkillConflict({ message: "A skill folder with this name already exists in the library." });
    throw error;
  }
}

function removeIfEmpty(path: string) {
  try {
    rmdirSync(path);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
  }
}

function checkContent(content: string, name: string) {
  if (Buffer.byteLength(content) > MAX_MARKDOWN_BYTES) throw new SkillInvalid({ message: "SKILL.md exceeds the size limit." });
  metadata(content, name);
}

class LocalSkills {
  readonly defaults: SkillSettings;
  readonly file: string;
  readonly guard: ReturnType<typeof pathGuard>;

  constructor(readonly options: Options, protection: Protection) {
    this.file = join(options.dataDir, "skills-settings.json");
    this.defaults = {
      library: join(options.configDir, "skills"),
      destinations: [
        { label: "OpenCode and Codex", path: join(options.home, ".agents", "skills") },
        { label: "Claude Code", path: join(options.home, ".claude", "skills") },
      ],
    };
    this.guard = pathGuard(protection);
  }

  settings() {
    if (!info(this.file)) return { settings: null, defaults: this.defaults, hash: null };
    const { bytes } = readRegular(this.file, 128 * 1024);
    return { settings: Schema.decodeUnknownSync(Settings)(JSON.parse(bytes.toString("utf8"))), defaults: this.defaults, hash: sha256(bytes) };
  }

  preview(settings: SkillSettings) {
    return previewPaths(settings, this.options.dataDir, this.options.home, this.guard);
  }

  paths(settings: SkillSettings) {
    const preview = this.preview(settings);
    const problems = preview.diagnostics.filter(({ kind }) => kind !== "alias");
    if (problems.length) throw new SkillInvalid({ message: problems.map(({ message }) => message).join("\n") });
    const destinations = preview.destinations.map(({ label, enteredPath, resolvedPath }) => {
      const path = enteredPath.trim();
      return path === resolvedPath ? { label, path } : { label, path, resolvedPath: resolvedPath! };
    });
    const library = preview.library.enteredPath.trim();
    const libraryResolvedPath = preview.library.resolvedPath!;
    return library === libraryResolvedPath ? { library, destinations } : { library, libraryResolvedPath, destinations };
  }

  configure(settings: SkillSettings, baseHash: string | null) {
    if (this.settings().hash !== baseHash) throw new SkillConflict({ message: "Settings changed. Reload them and try again." });
    const resolved = this.paths(settings);
    mkdirSync(resolved.libraryResolvedPath ?? resolved.library, { recursive: true });
    mkdirSync(dirname(this.file), { recursive: true });
    writeAtomic(this.file, JSON.stringify(resolved));
    return this.settings();
  }

  configured() {
    const { settings } = this.settings();
    if (settings === null) throw new SkillInvalid({ message: "Configure a local skills library first." });
    const resolved = this.paths(settings);
    const library = resolved.libraryResolvedPath ?? resolved.library;
    if ((settings.libraryResolvedPath ?? settings.library) !== library || settings.destinations.some((entry, index) => {
      const actual = resolved.destinations[index]!;
      return (entry.resolvedPath ?? entry.path) !== (actual.resolvedPath ?? actual.path);
    })) {
      throw new SkillConflict({ message: "A configured folder now resolves to a different path. Review Skills settings." });
    }
    return { library, destinations: physicalDestinations(resolved.destinations) };
  }

  list() {
    if (this.settings().settings === null) return { skills: [], problems: [] };
    return this.scan(this.configured().library);
  }

  private scan(library: string) {
    const skills: Array<(typeof Catalog.Type)["skills"][number]> = [];
    const problems: Array<(typeof Catalog.Type)["problems"][number]> = [];
    if (!info(library)) return { skills, problems: [{ path: library, message: "The library folder is missing." }] };
    const walk = (parent: string, prefix: string) => {
      for (const entry of readdirSync(parent, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith(".") || entry.name.includes("\\") || (!entry.isDirectory() && !entry.isSymbolicLink())) continue;
        const name = entry.name;
        const path = join(parent, name);
        const skillPath = prefix + name;
        try {
          this.guard(path);
          if (!info(path)?.isDirectory()) {
            if (entry.isSymbolicLink()) problems.push({ path, message: "Skipped a symbolic link in the library." });
            continue;
          }
          this.guard(join(path, "SKILL.md"));
          if (!info(join(path, "SKILL.md"))) {
            walk(path, skillPath + "/");
            continue;
          }
          const result = markdown(path, this.guard, name);
          skills.push({ name, skillPath, description: result.description, path });
        } catch (error) {
          problems.push({ path, message: isSkillProblem(error) ? error.message : "Could not read this library folder." });
        }
      }
    };
    walk(library, "");
    return { skills, problems };
  }

  source(settings: Pick<SkillSettings, "library">, skillPath: string) {
    const { path, name } = librarySkill(settings.library, skillPath, this.guard);
    const stat = info(path);
    if (!stat) throw new SkillNotFound({ message: "The skill is missing from the library." });
    if (!stat.isDirectory()) throw new SkillInvalid({ message: "The library skill must be a regular directory." });
    const document = markdown(path, this.guard, name);
    const bundle = readBundle(path, this.guard);
    if (document.content !== bundle.content) {
      throw new SkillConflict({ message: "SKILL.md changed while it was being read. Try again." });
    }
    return { path, document, bundle };
  }

  installSource(settings: Pick<SkillSettings, "library">, skillPath: string) {
    const source = this.source(settings, skillPath);
    let candidates: Array<{ path: string; digest: string | null }> | undefined;
    const copyStatus = (digest: string) => {
      candidates ??= this.scan(settings.library).skills
        .filter((candidate) => candidate.name === source.document.name)
        .map((candidate) => {
          if (candidate.skillPath === skillPath) return { path: skillPath, digest: source.bundle.digest };
          try {
            return { path: candidate.skillPath, digest: this.source(settings, candidate.skillPath).bundle.digest };
          } catch {
            return { path: candidate.skillPath, digest: null };
          }
        });
      const matches = candidates.filter((candidate) => candidate.digest === digest);
      if (matches.length === 1 && matches[0]?.path === skillPath) return "external installed" as const;
      if (matches.length === 0 && candidates.length === 1 && candidates[0]?.path === skillPath) return "external differs" as const;
      return "unmanaged" as const;
    };
    return { ...source, copyStatus };
  }

  detail(skillPath: string): Detail {
    const settings = this.configured();
    const source = this.installSource(settings, skillPath);
    const { path, document, bundle } = source;
    return {
      ...document,
      skillPath,
      path,
      files: [...bundle.files.values()].filter((entry) => entry.bytes !== null && entry.path !== "SKILL.md").map((entry) => entry.path),
      targets: settings.destinations.map((destination) => {
        try {
          return installTarget(this.options.dataDir, destination, document.name, skillPath, source, this.guard);
        } catch (error) {
          if (!isSkillProblem(error)) throw error;
          return { destination, path: join(destination.path, document.name), status: "conflict", actions: [], problem: error.message };
        }
      }),
    };
  }

  private add(library: string, name: string, writer: (stage: string) => void) {
    const target = join(library, name);
    this.guard(target);
    if (info(target)) throw new SkillConflict({ message: "A skill folder with this name already exists in the library." });
    mkdirSync(library, { recursive: true });
    const stage = mkdtempSync(join(library, ".skill-"));
    try {
      writer(stage);
      claimDirectory(target);
      try {
        renameSync(stage, target);
      } catch (error) {
        removeIfEmpty(target);
        throw error;
      }
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  }

  create(skillPath: string, content: string) {
    const { parent, name } = librarySkill(this.configured().library, skillPath, this.guard);
    checkContent(content, name);
    this.add(parent, name, (stage) => writeFileSync(join(stage, "SKILL.md"), content));
  }

  update(skillPath: string, content: string, baseHash: string) {
    const { path, name } = librarySkill(this.configured().library, skillPath, this.guard);
    checkContent(content, name);
    const file = join(path, "SKILL.md");
    this.guard(file);
    if (!info(path)?.isDirectory() || !info(file)?.isFile()) throw new SkillConflict({ message: "SKILL.md was removed or replaced. Reload before saving." });
    const current = readRegular(file, MAX_MARKDOWN_BYTES);
    if (sha256(current.bytes) !== baseHash) throw new SkillConflict({ message: "SKILL.md changed on disk. Review the disk version before saving." });
    writeAtomic(file, content, current.mode);
  }

  importFolder(input: string) {
    const { library, destinations } = this.configured();
    const path = configuredPath(input, this.guard, this.options.home);
    disjoint([library, path, ...destinations.map((destination) => destination.path)]);
    if (!info(path)) throw new SkillNotFound({ message: "The import folder does not exist." });
    const document = markdown(path, this.guard);
    const bundle = readBundle(path, this.guard);
    if (document.content !== bundle.content) throw new SkillConflict({ message: "The import changed while it was being read." });
    this.add(library, document.name, (stage) => {
      writeBundle(stage, bundle, this.guard);
      if (readBundle(stage, this.guard).digest !== bundle.digest) throw new SkillInvalid({ message: "The staged import failed verification." });
    });
    return document.name;
  }

  destination(path: string) {
    const settings = this.configured();
    const destination = settings.destinations.find((entry) => entry.path === path);
    if (destination === undefined) throw new SkillConflict({ message: "The install destination is no longer configured." });
    return { settings, destination };
  }

  recover(skillPath: string, path: string) {
    const { settings, destination } = this.destination(path);
    const { document } = this.source(settings, skillPath);
    recoverInstall(this.options.dataDir, destination, document.name, skillPath, this.guard);
  }

  plan(skillPath: string, path: string, action: Parameters<typeof installPlan>[4]) {
    const { settings, destination } = this.destination(path);
    const source = this.installSource(settings, skillPath);
    return installPlan(this.options.dataDir, destination, source.document.name, skillPath, action, source, this.guard);
  }
}

const attempt = <A>(operation: () => A): Effect.Effect<A, SkillError> =>
  Effect.try({ try: operation, catch: (cause) => isSkillProblem(cause) ? cause : new SkillStorageError({ cause }) });

export const makeSkills = (options: Options | null) => Layer.effect(Skills, Effect.gen(function* () {
  const material = yield* SecretMaterial;
  const local = <A>(operation: (store: LocalSkills) => A) => material.current.pipe(Effect.flatMap((protection) =>
    attempt(() => {
      if (options === null) throw new SkillInvalid({ message: "Local skills storage is unavailable." });
      return operation(new LocalSkills(options, protection));
    }),
  ));
  return Skills.of({
    settings: () => local((store) => store.settings()),
    previewSettings: (settings) => local((store) => store.preview(settings)),
    configure: ({ baseHash, ...settings }) => local((store) => store.configure(settings, baseHash)),
    list: () => local((store) => store.list()),
    detail: ({ skillPath }) => local((store) => store.detail(skillPath)),
    create: (skillPath, content) => local((store) => store.create(skillPath, content)),
    update: (skillPath, content, baseHash) => local((store) => store.update(skillPath, content, baseHash)),
    importFolder: (path) => local((store) => store.importFolder(path)),
    plan: ({ skillPath, destination, action }) => local((store) => store.plan(skillPath, destination, action)).pipe(
      Effect.map(({ review, apply }) => ({ review, apply: attempt(apply) })),
    ),
    recover: ({ skillPath, destination }) => local((store) => store.recover(skillPath, destination)),
  });
}));

export const SkillsLive = Layer.unwrap(Effect.gen(function* () {
  const configDir = yield* AppConfig.configDir;
  const dataDir = yield* AppConfig.dataDir;
  return makeSkills({ configDir, dataDir, home: homedir() });
}));
