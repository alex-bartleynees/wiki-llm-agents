import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
import { SkillProblem } from "./problem.js";
import { Skills } from "./repository.js";
import { writeAtomic } from "./state-file.js";

type Options = { configDir: string; dataDir: string; home: string; moveLive?: typeof renameSync; beforePlacement?: (from: string, to: string) => void };
const template = (name: string) => `---\nname: ${JSON.stringify(name)}\ndescription: Describe when to use this skill.\n---\n\n# ${name}\n\nWrite the skill instructions here.\n`;

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
    if (problems.length) throw new SkillProblem(problems.map(({ message }) => message).join("\n"));
    const destinations = preview.destinations.map(({ label, enteredPath, resolvedPath }) => {
      const path = enteredPath.trim();
      return path === resolvedPath ? { label, path } : { label, path, resolvedPath: resolvedPath! };
    });
    return { library: preview.library.resolvedPath!, destinations };
  }

  configure(settings: SkillSettings, baseHash: string | null) {
    if (this.settings().hash !== baseHash) throw new SkillProblem("Settings changed. Reload them and try again.", 409);
    const resolved = this.paths(settings);
    mkdirSync(resolved.library, { recursive: true });
    mkdirSync(dirname(this.file), { recursive: true });
    writeAtomic(this.file, JSON.stringify(resolved));
    return this.settings();
  }

  configured() {
    const { settings } = this.settings();
    if (settings === null) throw new SkillProblem("Configure a local skills library first.");
    const resolved = this.paths(settings);
    if (settings.library !== resolved.library || settings.destinations.some((entry, index) => {
      const actual = resolved.destinations[index]!;
      return (entry.resolvedPath ?? entry.path) !== (actual.resolvedPath ?? actual.path);
    })) {
      throw new SkillProblem("A configured folder now resolves to a different path. Review Skills settings.", 409);
    }
    return { library: resolved.library, destinations: physicalDestinations(resolved.destinations) };
  }

  list(query = "") {
    if (this.settings().settings === null) return { skills: [], problems: [] };
    return this.scan(this.configured().library, query);
  }

  private scan(library: string, query: string) {
    const skills: Array<(typeof Catalog.Type)["skills"][number]> = [];
    const problems: Array<(typeof Catalog.Type)["problems"][number]> = [];
    const needle = query.trim().toLowerCase();
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
          if (`${name} ${result.description}`.toLowerCase().includes(needle)) {
            skills.push({ name, skillPath, description: result.description, path });
          }
        } catch (error) {
          problems.push({ path, message: error instanceof SkillProblem ? error.message : "Could not read this library folder." });
        }
      }
    };
    walk(library, "");
    return { skills, problems };
  }

  source(settings: Pick<SkillSettings, "library">, skillPath: string) {
    const { path, name } = librarySkill(settings.library, skillPath, this.guard);
    const stat = info(path);
    if (!stat) throw new SkillProblem("The skill is missing from the library.", 404);
    if (!stat.isDirectory()) throw new SkillProblem("The library skill must be a regular directory.");
    const document = markdown(path, this.guard, name);
    const bundle = readBundle(path, this.guard);
    if (document.content !== bundle.content) {
      throw new SkillProblem("SKILL.md changed while it was being read. Try again.", 409);
    }
    return { path, document, bundle };
  }

  installSource(settings: Pick<SkillSettings, "library">, skillPath: string) {
    const source = this.source(settings, skillPath);
    let candidates: Array<{ path: string; digest: string | null }> | undefined;
    const copyStatus = (digest: string) => {
      candidates ??= this.scan(settings.library, source.document.name).skills
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
          if (!(error instanceof SkillProblem)) throw error;
          return { destination, path: join(destination.path, document.name), status: "conflict", actions: [], problem: error.message };
        }
      }),
    };
  }

  private add(library: string, name: string, writer: (stage: string) => void) {
    const target = join(library, name);
    this.guard(target);
    if (info(target)) throw new SkillProblem("A skill folder with this name already exists in the library.", 409);
    mkdirSync(library, { recursive: true });
    const stage = mkdtempSync(join(library, ".skill-"));
    try {
      writer(stage);
      if (info(target)) throw new SkillProblem("A skill folder with this name already exists in the library.", 409);
      renameSync(stage, target);
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  }

  save(skillPath: string, incoming: string, baseHash: string | null) {
    const { library } = this.configured();
    const { path, parent, name } = librarySkill(library, skillPath, this.guard);
    const content = baseHash === null && incoming === "" ? template(name) : incoming;
    if (Buffer.byteLength(content) > MAX_MARKDOWN_BYTES) throw new SkillProblem("SKILL.md exceeds the size limit.");
    metadata(content, name);
    if (baseHash === null) {
      this.add(parent, name, (stage) => writeFileSync(join(stage, "SKILL.md"), content));
    } else {
      const file = join(path, "SKILL.md");
      this.guard(file);
      if (!info(path)?.isDirectory() || !info(file)?.isFile()) throw new SkillProblem("SKILL.md was removed or replaced. Reload before saving.", 409);
      const current = readRegular(file, MAX_MARKDOWN_BYTES);
      if (sha256(current.bytes) !== baseHash) throw new SkillProblem("SKILL.md changed on disk. Review the disk version before saving.", 409);
      writeAtomic(file, content, current.mode);
    }
    return this.detail(skillPath);
  }

  importFolder(input: string) {
    const { library, destinations } = this.configured();
    const path = configuredPath(input, this.guard, this.options.home);
    disjoint([library, path, ...destinations.map((destination) => destination.path)]);
    if (!info(path)) throw new SkillProblem("The import folder does not exist.", 404);
    const document = markdown(path, this.guard);
    const bundle = readBundle(path, this.guard);
    if (document.content !== bundle.content) throw new SkillProblem("The import changed while it was being read.", 409);
    this.add(library, document.name, (stage) => {
      writeBundle(stage, bundle, this.guard);
      if (readBundle(stage, this.guard).digest !== bundle.digest) throw new SkillProblem("The staged import failed verification.");
    });
    return this.detail(document.name);
  }

  destination(path: string) {
    const settings = this.configured();
    const destination = settings.destinations.find((entry) => entry.path === path);
    if (destination === undefined) throw new SkillProblem("The install destination is no longer configured.", 409);
    return { settings, destination };
  }

  recover(skillPath: string, path: string) {
    const { settings, destination } = this.destination(path);
    const { document } = this.source(settings, skillPath);
    recoverInstall(this.options.dataDir, destination, document.name, skillPath, this.guard, this.options.beforePlacement);
    return this.detail(skillPath);
  }

  plan(skillPath: string, path: string, action: Parameters<typeof installPlan>[4]) {
    const { settings, destination } = this.destination(path);
    const source = this.installSource(settings, skillPath);
    return installPlan(this.options.dataDir, destination, source.document.name, skillPath, action, source, this.guard, this.options.moveLive, this.options.beforePlacement);
  }
}

export const makeSkills = (options: Options | null) => Layer.effect(Skills, Effect.gen(function* () {
  const material = yield* SecretMaterial;
  const local = <A>(operation: (store: LocalSkills) => A) => material.current.pipe(Effect.flatMap((protection) =>
    Effect.try({
      try: () => {
        if (options === null) throw new SkillProblem("Local skills storage is unavailable.");
        return operation(new LocalSkills(options, protection));
      },
      catch: (error) => error,
    }),
  ));
  return Skills.of({
    settings: () => local((store) => store.settings()),
    previewSettings: (settings) => local((store) => store.preview(settings)),
    configure: ({ baseHash, ...settings }) => local((store) => store.configure(settings, baseHash)),
    list: ({ q }) => local((store) => store.list(q)),
    detail: ({ skillPath }) => local((store) => store.detail(skillPath)),
    save: ({ skillPath, content, baseHash }) => local((store) => store.save(skillPath, content, baseHash)),
    importFolder: ({ path }) => local((store) => store.importFolder(path)),
    review: ({ skillPath, destination, action }) => local((store) => store.plan(skillPath, destination, action).review),
    recover: ({ skillPath, destination }) => local((store) => store.recover(skillPath, destination)),
    apply: ({ skillPath, destination, action, token }) => local((store) => {
      const plan = store.plan(skillPath, destination, action);
      if (plan.review.token !== token) throw new SkillProblem("The files changed since review. Review the new diff.", 409);
      plan.apply();
      return store.detail(skillPath);
    }),
  });
}));

export const SkillsLive = Layer.unwrap(Effect.gen(function* () {
  const configDir = yield* AppConfig.configDir;
  const dataDir = yield* AppConfig.dataDir;
  return makeSkills({ configDir, dataDir, home: homedir() });
}));
