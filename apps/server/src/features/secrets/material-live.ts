import { Effect, FileSystem, Layer } from "effect";
import { AppConfig } from "../../shared/config.js";
import { parseProtectedPaths } from "../../shared/secret-paths.js";
import { McpServerCatalog } from "../mcp-servers/catalog.js";
import { referencesOf } from "../mcp-servers/definition.js";
import { SecretMaterial, type SecretMaterialList } from "./material.js";
import { SecretStore } from "./secret-store.js";

/**
 * The secret store's files, the MCP servers' `${file:…}` and `${env:…}` references
 * (read on every `current`) and `WIKI_AGENTS_PROTECTED_PATHS` (read once).
 */
export const SecretMaterialLive = Layer.effect(
  SecretMaterial,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const store = yield* SecretStore;
    const catalog = yield* McpServerCatalog;
    const configured = parseProtectedPaths(yield* AppConfig.protectedPaths.pipe(Effect.orDie));
    for (const problem of configured.problems) yield* Effect.logWarning(`WIKI_AGENTS_PROTECTED_PATHS: ${problem} It is left out.`);
    let latest: SecretMaterialList = { paths: [], names: configured.names, envNames: [] };

    const current = Effect.gen(function* () {
      const { servers } = yield* catalog.current;
      const references = servers.map(referencesOf);
      const written = [...store.files, ...references.flatMap((found) => found.files), ...configured.paths];
      const paths = new Set<string>(written);
      for (const path of written) {
        const real = yield* fs.realPath(path).pipe(Effect.orElseSucceed(() => path));
        paths.add(real);
      }
      const list: SecretMaterialList = {
        paths: [...paths].sort(),
        names: configured.names,
        envNames: [...new Set(references.flatMap((found) => found.envNames))].sort(),
      };
      latest = list;
      return list;
    });

    // Read once now, so providers started before the first turn already go without them.
    yield* current;
    return SecretMaterial.of({ current, latest: () => latest });
  }),
);
