import type { Pin } from "@wiki-agents/contracts/pins/model";
import { fileKind } from "@wiki-agents/contracts/notes/model";
import { Effect } from "effect";
import { type TitledFile, VaultIndex } from "../indexing/vault-index.js";
import { PinRepository } from "./repository.js";

/** The vault's pins with their current titles, read from the index. */
export const listVaultPins = Effect.fnUntraced(function* (vaultId: string, files?: ReadonlyArray<TitledFile>) {
  const paths = yield* (yield* PinRepository).list(vaultId);
  const byPath = new Map((files ?? (yield* (yield* VaultIndex).titledFiles(vaultId))).map((file) => [file.path, file]));
  return paths.map((path): Pin => {
    const file = byPath.get(path);
    return { path, kind: file?.kind ?? fileKind(path), title: file?.title ?? null };
  });
});
