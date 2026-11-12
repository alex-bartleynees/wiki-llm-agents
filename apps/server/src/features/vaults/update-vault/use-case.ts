import type { UpdateVaultRequest } from "@wiki-agents/contracts/vaults/update-vault/request";
import { Data, Effect, FileSystem } from "effect";
import { resolveInVault } from "../../../shared/vault/path-guard.js";
import { findVault } from "../find-vault.js";
import { VaultRepository } from "../repository.js";

export class InvalidTemplateFolder extends Data.TaggedError("InvalidTemplateFolder")<{
  readonly folder: string;
  readonly reason: string;
}> {}

export interface UpdateVaultInput extends UpdateVaultRequest {
  readonly vaultId: string;
}

/**
 * Sets a vault's template folder: a folder that exists in the vault, stored
 * normalised (`Templates/`, `./Templates` → `Templates`); empty turns templates off.
 */
export const updateVault = Effect.fn("updateVault")(function* (request: UpdateVaultInput) {
  const vault = yield* findVault(request.vaultId);
  const requested = request.templateFolder?.trim() ?? "";
  let templateFolder: string | null = null;
  if (requested !== "") {
    const notFolder = (reason: string) => new InvalidTemplateFolder({ folder: requested, reason });
    const { path, absolute } = yield* resolveInVault(vault.rootPath, requested).pipe(
      Effect.catchTags({
        InvalidVaultPath: () => Effect.fail(notFolder("Not a folder in this vault")),
        VaultFileNotFound: () => Effect.fail(notFolder("Folder not found")),
      }),
    );
    const info = yield* (yield* FileSystem.FileSystem).stat(absolute);
    if (info.type !== "Directory") return yield* notFolder("Not a folder");
    templateFolder = path;
  }
  yield* (yield* VaultRepository).setTemplateFolder(vault.id, templateFolder);
  return { ...vault, templateFolder };
});
