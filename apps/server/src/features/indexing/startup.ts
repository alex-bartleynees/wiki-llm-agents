import { Effect, Layer } from "effect";
import { VaultRepository } from "../vaults/repository.js";
import { trackVault } from "./track-vault.js";

/**
 * At startup, catch up with changes made while the app was off and start watching,
 * for every registered vault. Runs in the background so the server answers at once;
 * the index from the last run serves requests meanwhile.
 */
export const IndexingStartup = Layer.effectDiscard(
  Effect.gen(function* () {
    const vaults = yield* (yield* VaultRepository).list;
    yield* Effect.forEach(vaults, (vault) => trackVault(vault).pipe(Effect.catch((error) => Effect.logWarning(`can't index ${vault.name}`, error))), {
      discard: true,
    }).pipe(Effect.forkScoped);
  }),
);
