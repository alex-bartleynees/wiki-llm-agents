import { basename, join } from "node:path";
import type { ConfigProblem } from "@wiki-agents/contracts/agents/model";
import { Effect, FileSystem, Layer, Option, Result } from "effect";
import { ID_PATTERN, readConfigFile } from "../../shared/config-files.js";
import { AgentCatalog } from "../agents/catalog.js";
import { McpServerCatalog, type McpServerList, McpServerNotFound } from "./catalog.js";
import { MAX_FILE_BYTES, MCP_EXTENSION, MCP_FOLDER, type McpServerDefinition, parseMcpServer } from "./definition.js";

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Every `*.yaml` in `folder`, parsed; files that fail become problems. A missing folder is an empty list. */
export const loadMcpServers = (fs: FileSystem.FileSystem, folder: string) =>
  Effect.gen(function* () {
    const servers: Array<McpServerDefinition> = [];
    const problems: Array<ConfigProblem> = [];
    const list = (): McpServerList => ({ folder, servers: servers.sort((a, b) => a.title.localeCompare(b.title)), problems });
    if (!(yield* fs.exists(folder).pipe(Effect.orElseSucceed(() => false)))) return list();
    const names = yield* fs.readDirectory(folder).pipe(Effect.result);
    if (Result.isFailure(names)) {
      problems.push({ path: folder, message: `Couldn't read the folder: ${describe(names.failure)}` });
      return list();
    }
    for (const name of [...names.success].filter((name) => name.endsWith(MCP_EXTENSION) && !name.startsWith(".")).sort()) {
      const path = join(folder, name);
      const read = yield* Effect.gen(function* () {
        const info = yield* fs.stat(path);
        if (info.type !== "File") return Result.fail(["Not a file."]);
        if (Number(info.size) > MAX_FILE_BYTES) return Result.fail([`The file is over ${MAX_FILE_BYTES / 1024} KiB.`]);
        return parseMcpServer(basename(name, MCP_EXTENSION), path, yield* fs.readFileString(path));
      }).pipe(Effect.catch((error) => Effect.succeed(Result.fail([`Couldn't read it: ${describe(error)}`]))));
      if (Result.isSuccess(read)) servers.push(read.success);
      else problems.push({ path, message: read.failure.join(" ") });
    }
    return list();
  });

/** The catalog over `mcp/` in the agents' config directory. */
export const McpServerCatalogLive = Layer.effect(
  McpServerCatalog,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const agents = yield* AgentCatalog;
    const folder = Effect.map(agents.current, ({ configDir }) => join(configDir, MCP_FOLDER));
    return McpServerCatalog.of({
      current: Effect.flatMap(folder, (path) => loadMcpServers(fs, path)),
      get: Effect.fnUntraced(function* (serverId: string) {
        const missing = (problem: string | null) => new McpServerNotFound({ serverId, problem });
        if (!ID_PATTERN.test(serverId)) return yield* missing(null);
        const path = join(yield* folder, `${serverId}${MCP_EXTENSION}`);
        const file = yield* readConfigFile(path).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.mapError((error) => missing(error._tag === "ConfigFileInvalid" ? error.problems.join(" ") : `Couldn't read it: ${describe(error)}`)),
        );
        if (Option.isNone(file)) return yield* missing(null);
        const parsed = parseMcpServer(serverId, path, file.value.text);
        if (Result.isFailure(parsed)) return yield* missing(parsed.failure.join(" "));
        return { server: parsed.success, hash: file.value.hash };
      }),
    });
  }),
);
