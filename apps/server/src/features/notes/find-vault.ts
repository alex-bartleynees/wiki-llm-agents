import { Effect, Option } from "effect";
import { VaultRepository } from "../vaults/repository.js";
import { VaultNotFound } from "./errors.js";

export const findVault = Effect.fnUntraced(function* (vaultId: string) {
  const repository = yield* VaultRepository;
  const vault = yield* repository.findById(vaultId);
  if (Option.isNone(vault)) return yield* new VaultNotFound({ vaultId });
  return vault.value;
});
