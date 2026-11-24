import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type Catalog, type Detail, type InstallAction, type InstallTarget, type Settings as SkillSettings, Settings } from "@wiki-agents/contracts/skills/model";
import { Effect, FileSystem, Layer, Schema, Semaphore } from "effect";
import { sha256 } from "../../shared/config-files.js";
import { AppConfig } from "../../shared/config.js";
import { removeEmptyDirectory } from "../../shared/node-files.js";
import { type Protection } from "../../shared/secret-paths.js";
import { SecretMaterial } from "../secrets/material.js";
import { info, isDirectory, markdown, MAX_MARKDOWN_BYTES, metadata, readBundle, readRegular, type StorageFailure, writeBundle } from "./bundle.js";
import { installPlan, installTarget, recoverInstall, removeTree } from "./installs.js";
import { configuredPath, disjoint, librarySkill, pathGuard, physicalDestinations, previewPaths } from "./paths.js";
import { isSkillProblem, SkillConflict, type SkillError, SkillInvalid, SkillNotFound, type SkillProblem, SkillStorageError } from "./errors.js";
import { Skills } from "./skills.js";
import { writeAtomic } from "./state-file.js";

type Options = { configDir: string; dataDir: string; home: string };

const CONCURRENT_READS = 4;

const nameTaken = () => new SkillConflict({ message: "A skill folder with this name already exists in the library." });

const removeIfEmpty = (path: string) =>
  removeEmptyDirectory(path).pipe(
    Effect.catchIf((error) => error.code === "ENOENT" || error.code === "ENOTEMPTY", () => Effect.void),
  );

const checkContent = Effect.fnUntraced(function* (content: string, name: string) {
  if (Buffer.byteLength(content) > MAX_MARKDOWN_BYTES) return yield* new SkillInvalid({ message: "SKILL.md exceeds the size limit." });
  yield* metadata(content, name);
});

const openSkills = (options: Options, protection: Protection) => Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const file = join(options.dataDir, "skills-settings.json");
  const guard = pathGuard(protection);
  const defaults: SkillSettings = {
    library: join(options.configDir, "skills"),
    destinations: [
      { label: "OpenCode and Codex", path: join(options.home, ".agents", "skills") },
      { label: "Claude Code", path: join(options.home, ".claude", "skills") },
    ],
  };

  const settings = Effect.gen(function* () {
    if ((yield* info(file)) === undefined) return { settings: null, defaults, hash: null };
    const { bytes } = yield* readRegular(file, 128 * 1024);
    return { settings: yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Settings))(bytes.toString("utf8")), defaults, hash: sha256(bytes) };
  });

  const preview = (request: SkillSettings) => previewPaths(request, options.dataDir, options.home, guard);

  const paths = Effect.fnUntraced(function* (request: SkillSettings) {
    const result = yield* preview(request);
    const problems = result.diagnostics.filter(({ kind }) => kind !== "alias");
    if (problems.length) return yield* new SkillInvalid({ message: problems.map(({ message }) => message).join("\n") });
    const destinations = result.destinations.map(({ label, enteredPath, resolvedPath }) => {
      const path = enteredPath.trim();
      return path === resolvedPath ? { label, path } : { label, path, resolvedPath: resolvedPath! };
    });
    const library = result.library.enteredPath.trim();
    const libraryResolvedPath = result.library.resolvedPath!;
    const resolved: SkillSettings = library === libraryResolvedPath ? { library, destinations } : { library, libraryResolvedPath, destinations };
    return resolved;
  });

  const configure = Effect.fnUntraced(function* (request: SkillSettings, baseHash: string | null) {
    if ((yield* settings).hash !== baseHash) return yield* new SkillConflict({ message: "Settings changed. Reload them and try again." });
    const resolved = yield* paths(request);
    yield* fs.makeDirectory(resolved.libraryResolvedPath ?? resolved.library, { recursive: true });
    yield* fs.makeDirectory(dirname(file), { recursive: true });
    yield* writeAtomic(file, JSON.stringify(resolved));
    return yield* settings;
  });

  const configured = Effect.gen(function* () {
    const { settings: saved } = yield* settings;
    if (saved === null) return yield* new SkillInvalid({ message: "Configure a local skills library first." });
    const resolved = yield* paths(saved);
    const library = resolved.libraryResolvedPath ?? resolved.library;
    if ((saved.libraryResolvedPath ?? saved.library) !== library || saved.destinations.some((entry, index) => {
      const actual = resolved.destinations[index]!;
      return (entry.resolvedPath ?? entry.path) !== (actual.resolvedPath ?? actual.path);
    })) {
      return yield* new SkillConflict({ message: "A configured folder now resolves to a different path. Review Skills settings." });
    }
    return { library, destinations: physicalDestinations(resolved.destinations) };
  });

  const scan = Effect.fnUntraced(function* (library: string) {
    const skills: Array<(typeof Catalog.Type)["skills"][number]> = [];
    const problems: Array<(typeof Catalog.Type)["problems"][number]> = [];
    if ((yield* info(library)) === undefined) return { skills, problems: [{ path: library, message: "The library folder is missing." }] };
    const visit = Effect.fnUntraced(function* (entry: FileSystem.DirectoryEntry, path: string, skillPath: string) {
      yield* guard(path);
      if (!(yield* isDirectory(path))) {
        if (entry.type === "SymbolicLink") problems.push({ path, message: "Skipped a symbolic link in the library." });
        return;
      }
      yield* guard(join(path, "SKILL.md"));
      if ((yield* info(join(path, "SKILL.md"))) === undefined) return yield* walk(path, skillPath + "/");
      const result = yield* markdown(path, guard, entry.name);
      skills.push({ name: entry.name, skillPath, description: result.description, path });
    });
    const walk = (parent: string, prefix: string): Effect.Effect<void, StorageFailure, FileSystem.FileSystem> =>
      Effect.gen(function* () {
        for (const entry of [...(yield* fs.readDirectoryEntries(parent))].sort((a, b) => a.name.localeCompare(b.name))) {
          if (entry.name.startsWith(".") || entry.name.includes("\\") || (entry.type !== "Directory" && entry.type !== "SymbolicLink")) continue;
          const path = join(parent, entry.name);
          yield* visit(entry, path, prefix + entry.name).pipe(
            Effect.catch((error: SkillProblem | StorageFailure) =>
              Effect.sync(() => {
                problems.push({ path, message: isSkillProblem(error) ? error.message : "Could not read this library folder." });
              }),
            ),
          );
        }
      });
    yield* walk(library, "");
    return { skills, problems };
  });

  const list = Effect.gen(function* () {
    if ((yield* settings).settings === null) return { skills: [], problems: [] };
    return yield* scan((yield* configured).library);
  });

  const source = Effect.fnUntraced(function* (library: string, skillPath: string) {
    const { path, name } = yield* librarySkill(library, skillPath, guard);
    const stat = yield* info(path);
    if (stat === undefined) return yield* new SkillNotFound({ message: "The skill is missing from the library." });
    if (stat.type !== "Directory") return yield* new SkillInvalid({ message: "The library skill must be a regular directory." });
    const document = yield* markdown(path, guard, name);
    const bundle = yield* readBundle(path, guard);
    if (document.content !== bundle.content) return yield* new SkillConflict({ message: "SKILL.md changed while it was being read. Try again." });
    return { path, document, bundle };
  });

  const installSource = Effect.fnUntraced(function* (library: string, skillPath: string) {
    const selected = yield* source(library, skillPath);
    const candidates = yield* Effect.cached(Effect.gen(function* () {
      const sameName = (yield* scan(library)).skills.filter((candidate) => candidate.name === selected.document.name);
      return yield* Effect.forEach(sameName, (candidate) =>
        candidate.skillPath === skillPath
          ? Effect.succeed({ path: skillPath, digest: selected.bundle.digest })
          : source(library, candidate.skillPath).pipe(
              Effect.map(({ bundle }) => ({ path: candidate.skillPath, digest: bundle.digest })),
              Effect.catch(() => Effect.succeed({ path: candidate.skillPath, digest: null })),
            ),
      );
    }));
    const copyStatus = (digest: string) => Effect.map(candidates, (all) => {
      const matches = all.filter((candidate) => candidate.digest === digest);
      if (matches.length === 1 && matches[0]?.path === skillPath) return "external installed" as const;
      if (matches.length === 0 && all.length === 1 && all[0]?.path === skillPath) return "external differs" as const;
      return "unmanaged" as const;
    });
    return { ...selected, copyStatus };
  });

  const detail = Effect.fnUntraced(function* (skillPath: string) {
    const current = yield* configured;
    const selected = yield* installSource(current.library, skillPath);
    const { path, document, bundle } = selected;
    const targets = yield* Effect.forEach(current.destinations, (destination) =>
      installTarget(options.dataDir, destination, document.name, skillPath, selected, guard).pipe(
        Effect.catchIf(isSkillProblem, (error) =>
          Effect.succeed<InstallTarget>({ destination, path: join(destination.path, document.name), status: "conflict", actions: [], problem: error.message }),
        ),
      ),
    );
    return {
      ...document,
      skillPath,
      path,
      files: [...bundle.files.values()].filter((entry) => entry.file !== null && entry.path !== "SKILL.md").map((entry) => entry.path),
      targets,
    } satisfies Detail;
  });

  const add = Effect.fnUntraced(function* <E>(library: string, name: string, writer: (stage: string) => Effect.Effect<void, E, FileSystem.FileSystem>) {
    const target = join(library, name);
    yield* guard(target);
    if (yield* info(target)) return yield* nameTaken();
    yield* fs.makeDirectory(library, { recursive: true });
    yield* Effect.acquireUseRelease(
      fs.makeTempDirectory({ directory: library, prefix: ".skill-" }),
      (stage) =>
        Effect.gen(function* () {
          yield* writer(stage);
          yield* fs.makeDirectory(target).pipe(Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.fail(nameTaken())));
          yield* fs.rename(stage, target).pipe(
            Effect.catchCause((cause) => Effect.andThen(removeIfEmpty(target), Effect.failCause(cause))),
          );
        }),
      removeTree,
    );
  });

  const create = Effect.fnUntraced(function* (skillPath: string, content: string) {
    const { parent, name } = yield* librarySkill((yield* configured).library, skillPath, guard);
    yield* checkContent(content, name);
    yield* add(parent, name, (stage) => fs.writeFileString(join(stage, "SKILL.md"), content));
  });

  const update = Effect.fnUntraced(function* (skillPath: string, content: string, baseHash: string) {
    const { path, name } = yield* librarySkill((yield* configured).library, skillPath, guard);
    yield* checkContent(content, name);
    const document = join(path, "SKILL.md");
    yield* guard(document);
    if (!(yield* isDirectory(path)) || (yield* info(document))?.type !== "File") {
      return yield* new SkillConflict({ message: "SKILL.md was removed or replaced. Reload before saving." });
    }
    const current = yield* readRegular(document, MAX_MARKDOWN_BYTES);
    if (sha256(current.bytes) !== baseHash) return yield* new SkillConflict({ message: "SKILL.md changed on disk. Review the disk version before saving." });
    yield* writeAtomic(document, content, current.mode);
  });

  const importFolder = Effect.fnUntraced(function* (input: string) {
    const { library, destinations } = yield* configured;
    const path = yield* configuredPath(input, guard, options.home);
    yield* disjoint([library, path, ...destinations.map((destination) => destination.path)]);
    if ((yield* info(path)) === undefined) return yield* new SkillNotFound({ message: "The import folder does not exist." });
    const document = yield* markdown(path, guard);
    const bundle = yield* readBundle(path, guard);
    if (document.content !== bundle.content) return yield* new SkillConflict({ message: "The import changed while it was being read." });
    yield* add(library, document.name, (stage) =>
      Effect.gen(function* () {
        yield* writeBundle(stage, bundle, guard);
        if ((yield* readBundle(stage, guard)).digest !== bundle.digest) return yield* new SkillInvalid({ message: "The staged import failed verification." });
      }),
    );
    return document.name;
  });

  const findDestination = Effect.fnUntraced(function* (path: string) {
    const { library, destinations } = yield* configured;
    const destination = destinations.find((entry) => entry.path === path);
    if (destination === undefined) return yield* new SkillConflict({ message: "The install destination is no longer configured." });
    return { library, destination };
  });

  const recover = Effect.fnUntraced(function* (skillPath: string, path: string) {
    const { library, destination } = yield* findDestination(path);
    const { document } = yield* source(library, skillPath);
    yield* recoverInstall(options.dataDir, destination, document.name, skillPath, guard);
  });

  const plan = Effect.fnUntraced(function* (skillPath: string, path: string, action: InstallAction) {
    const { library, destination } = yield* findDestination(path);
    const selected = yield* installSource(library, skillPath);
    return yield* installPlan(options.dataDir, destination, selected.document.name, skillPath, action, selected, guard);
  });

  return { settings, preview, configure, list, detail, create, update, importFolder, recover, plan };
});

type LocalSkills = Effect.Success<ReturnType<typeof openSkills>>;

export const makeSkills = (options: Options | null) => Layer.effect(Skills, Effect.gen(function* () {
  const material = yield* SecretMaterial;
  const fs = yield* FileSystem.FileSystem;
  const lock = yield* Semaphore.make(CONCURRENT_READS);

  const typed = <A, E>(operation: Effect.Effect<A, E, FileSystem.FileSystem>): Effect.Effect<A, SkillError> =>
    operation.pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.mapError((error) => isSkillProblem(error) ? error : new SkillStorageError({ cause: error })),
    );
  const exclusively = <A, E>(operation: Effect.Effect<A, E>) => lock.withPermits(CONCURRENT_READS)(Effect.uninterruptible(operation));
  const local = <A, E>(operation: (store: LocalSkills) => Effect.Effect<A, E, FileSystem.FileSystem>) =>
    Effect.gen(function* () {
      const protection = yield* material.current;
      if (options === null) return yield* new SkillInvalid({ message: "Local skills storage is unavailable." });
      return yield* typed(Effect.flatMap(openSkills(options, protection), operation));
    });
  const read = <A, E>(operation: (store: LocalSkills) => Effect.Effect<A, E, FileSystem.FileSystem>) => lock.withPermit(local(operation));
  const mutate = <A, E>(operation: (store: LocalSkills) => Effect.Effect<A, E, FileSystem.FileSystem>) => exclusively(local(operation));

  return Skills.of({
    settings: () => read((store) => store.settings),
    previewSettings: (settings) => read((store) => store.preview(settings)),
    configure: ({ baseHash, ...settings }) => mutate((store) => store.configure(settings, baseHash)),
    list: () => read((store) => store.list),
    detail: ({ skillPath }) => read((store) => store.detail(skillPath)),
    create: (skillPath, content) => mutate((store) => store.create(skillPath, content)),
    update: (skillPath, content, baseHash) => mutate((store) => store.update(skillPath, content, baseHash)),
    importFolder: (path) => mutate((store) => store.importFolder(path)),
    plan: ({ skillPath, destination, action }) => read((store) => store.plan(skillPath, destination, action)).pipe(
      Effect.map(({ review, apply }) => ({ review, apply: exclusively(typed(apply)) })),
    ),
    recover: ({ skillPath, destination }) => mutate((store) => store.recover(skillPath, destination)),
  });
}));

export const SkillsLive = Layer.unwrap(Effect.gen(function* () {
  const configDir = yield* AppConfig.configDir;
  const dataDir = yield* AppConfig.dataDir;
  return makeSkills({ configDir, dataDir, home: homedir() });
}));
