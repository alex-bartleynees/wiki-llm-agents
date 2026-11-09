import { resolve } from "node:path";
import { Effect, Layer } from "effect";
import { registerVault } from "./register-vault/use-case.js";

/**
 * Registers the folders given with `--vault` at startup (relative paths are taken
 * from the working directory). A folder that can't be registered stops the app.
 */
export const startupVaults = (paths: ReadonlyArray<string>) =>
  Layer.effectDiscard(
    Effect.forEach(paths, (path) =>
      registerVault({ rootPath: resolve(path) }).pipe(
        Effect.tap(({ vault, created }) =>
          Effect.logInfo(`${created ? "Registered" : "Using"} vault ${vault.name} at ${vault.rootPath}`),
        ),
      ),
    ),
  );
