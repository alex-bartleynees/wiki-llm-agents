import { Effect, FileSystem, Layer } from "effect";
import { McpServerCatalog } from "../mcp-servers/catalog.js";
import { referencesOf } from "../mcp-servers/definition.js";
import { SecretMaterial, type SecretMaterialList } from "./material.js";
import { SecretStore } from "./secret-store.js";

/** The secret store's files and the MCP servers' `${file:…}` and `${env:…}` references, read on every `current`. */
export const SecretMaterialLive = Layer.effect(
  SecretMaterial,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const store = yield* SecretStore;
    const catalog = yield* McpServerCatalog;
    let latest: SecretMaterialList = { paths: [], envNames: [] };

    const current = Effect.gen(function* () {
      const { servers } = yield* catalog.current;
      const references = servers.map(referencesOf);
      const written = [...store.files, ...references.flatMap((found) => found.files)];
      const paths = new Set<string>(written);
      for (const path of written) {
        const real = yield* fs.realPath(path).pipe(Effect.orElseSucceed(() => path));
        paths.add(real);
      }
      const list: SecretMaterialList = {
        paths: [...paths].sort(),
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
