import { basename, join } from "node:path";
import type { ConfigProblem } from "@wiki-agents/contracts/agents/model";
import { watch } from "chokidar";
import { Deferred, Effect, FileSystem, Layer, PubSub, Queue, Result, Stream, SubscriptionRef } from "effect";
import { AppConfig } from "../../shared/config.js";
import { AgentCatalog, type AgentConfig, AgentNotFound } from "./catalog.js";
import { DEFAULT_AGENTS, DEFAULT_RULES } from "./default-config.js";
import { type AgentDefinition, conflictCopyProblem, MAX_FILE_BYTES, parseAgent, parseRules, type RulesDefinition } from "./definition.js";

/** Editors save in bursts (temp file, rename, chmod); load once they settle. */
const SETTLE = "200 millis";

export interface AgentCatalogOptions {
  readonly dir: string;
  /** Reload when the files change. Off in tests, which call `reload`. */
  readonly watch: boolean;
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Writes the default rules and agents into a folder that doesn't exist yet, so a
 * first start has something to work with while your edits and deletions stick.
 * Each folder is written beside its final name and renamed into place, so a crash
 * or a second app starting at the same moment never leaves a half-filled folder.
 */
const seed = (fs: FileSystem.FileSystem, dir: string) =>
  Effect.gen(function* () {
    const problems: Array<ConfigProblem> = [];
    for (const [folder, files] of [
      ["rules", DEFAULT_RULES],
      ["agents", DEFAULT_AGENTS],
    ] as const) {
      const path = join(dir, folder);
      const written = yield* Effect.gen(function* () {
        if (yield* fs.exists(path)) return;
        yield* fs.makeDirectory(dir, { recursive: true });
        const staging = yield* fs.makeTempDirectory({ directory: dir, prefix: `.${folder}-` });
        for (const [id, text] of Object.entries(files)) yield* fs.writeFileString(join(staging, `${id}.md`), text);
        // Someone else's seed may have landed first; theirs wins.
        yield* fs.rename(staging, path).pipe(Effect.catch(() => fs.remove(staging, { recursive: true })));
      }).pipe(Effect.result);
      if (Result.isFailure(written)) problems.push({ path, message: `Couldn't create the defaults: ${describe(written.failure)}` });
    }
    return problems;
  });

/** Every `*.md` in `folder`, parsed; files that fail become problems. */
const loadFolder = <A>(
  fs: FileSystem.FileSystem,
  folder: string,
  parse: (id: string, path: string, text: string) => Result.Result<A, ReadonlyArray<string>>,
) =>
  Effect.gen(function* () {
    const loaded: Array<A> = [];
    const problems: Array<ConfigProblem> = [];
    if (!(yield* fs.exists(folder).pipe(Effect.orElseSucceed(() => false)))) return { loaded, problems };
    const names = yield* fs.readDirectory(folder).pipe(Effect.result);
    if (Result.isFailure(names)) return { loaded, problems: [{ path: folder, message: `Couldn't read the folder: ${describe(names.failure)}` }] };
    for (const name of [...names.success].filter((name) => name.endsWith(".md") && !name.startsWith(".")).sort()) {
      const path = join(folder, name);
      const conflict = conflictCopyProblem(name);
      if (conflict !== null) {
        problems.push({ path, message: conflict });
        continue;
      }
      const read = yield* Effect.gen(function* () {
        const info = yield* fs.stat(path);
        if (info.type !== "File") return Result.fail(["Not a file."]);
        if (Number(info.size) > MAX_FILE_BYTES) return Result.fail([`The file is over ${MAX_FILE_BYTES / 1024} KiB.`]);
        return parse(basename(name, ".md"), path, yield* fs.readFileString(path));
      }).pipe(Effect.catch((error) => Effect.succeed(Result.fail([`Couldn't read it: ${describe(error)}`]))));
      if (Result.isSuccess(read)) loaded.push(read.success);
      else problems.push({ path, message: read.failure.join(" ") });
    }
    return { loaded, problems };
  });

export const loadConfig = (fs: FileSystem.FileSystem, dir: string, extraProblems: ReadonlyArray<ConfigProblem> = []) =>
  Effect.gen(function* () {
    const rules = yield* loadFolder<RulesDefinition>(fs, join(dir, "rules"), parseRules);
    const agents = yield* loadFolder<AgentDefinition>(fs, join(dir, "agents"), parseAgent);
    const config: AgentConfig = {
      configDir: dir,
      rules: rules.loaded,
      agents: [...agents.loaded].sort((a, b) => a.name.localeCompare(b.name)),
      problems: [...extraProblems, ...rules.problems, ...agents.problems],
    };
    return config;
  });

/** Paths of the config folder's changes, from chokidar; ends with the scope. `ready` is done once it watches. */
const changesIn = (dir: string, ready: Deferred.Deferred<void>) =>
  Stream.callback<string>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() =>
        watch(dir, { ignoreInitial: true, depth: 1 })
          .on("all", (_event, path) => Queue.offerUnsafe(queue, path))
          .on("ready", () => Deferred.doneUnsafe(ready, Effect.void))
          .on("error", (error) => Queue.offerUnsafe(queue, `error: ${describe(error)}`)),
      ),
      (watcher) => Effect.promise(() => watcher.close()),
    ),
  );

/**
 * The config directory, seeded on first start, loaded now and again whenever its
 * files change. A file that fails to load is reported, not fatal: the other agents
 * still work.
 */
export const makeAgentCatalog = (options: AgentCatalogOptions) =>
  Layer.effect(
    AgentCatalog,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const seeding = yield* seed(fs, options.dir);
      const state = yield* SubscriptionRef.make(yield* loadConfig(fs, options.dir, seeding));
      const loaded = yield* PubSub.unbounded<AgentConfig>();

      const reload = Effect.gen(function* () {
        const config = yield* loadConfig(fs, options.dir);
        yield* SubscriptionRef.set(state, config);
        yield* PubSub.publish(loaded, config);
        return config;
      });

      if (options.watch) {
        const ready = yield* Deferred.make<void>();
        yield* changesIn(options.dir, ready).pipe(
          Stream.debounce(SETTLE),
          Stream.runForEach(() =>
            Effect.flatMap(reload, (config) =>
              config.problems.length === 0 ? Effect.void : Effect.logWarning("agent config has problems", config.problems),
            ),
          ),
          Effect.forkScoped,
        );
        // Load again once watching, so a change made before the watcher was ready isn't missed.
        yield* Deferred.await(ready);
        yield* reload;
      }

      const current = SubscriptionRef.get(state);
      return AgentCatalog.of({
        current,
        reload,
        subscribe: PubSub.subscribe(loaded),
        get: (agentId) =>
          Effect.flatMap(current, (config) => {
            const agent = config.agents.find((candidate) => candidate.id === agentId);
            if (agent !== undefined) return Effect.succeed(agent);
            const problem = config.problems.find((candidate) => candidate.path === join(config.configDir, "agents", `${agentId}.md`));
            return Effect.fail(new AgentNotFound({ agentId, problem: problem?.message ?? null }));
          }),
      });
    }),
  );

/** The catalog over `WIKI_AGENTS_CONFIG_DIR`, watched. */
export const AgentCatalogLive = Layer.unwrap(
  Effect.gen(function* () {
    const dir = yield* AppConfig.configDir.pipe(Effect.orDie);
    return makeAgentCatalog({ dir, watch: true });
  }),
);
