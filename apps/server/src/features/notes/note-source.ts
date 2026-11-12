import { createHash } from "node:crypto";
import { Effect, FileSystem, Option } from "effect";
import { InvalidVaultPath } from "../../shared/vault/errors.js";
import { resolveInVault } from "../../shared/vault/path-guard.js";

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Only markdown files are notes that can be edited. */
export const requireNotePath = (path: string) =>
  path.toLowerCase().endsWith(".md") ? Effect.void : Effect.fail(new InvalidVaultPath({ path }));

/** A note's bytes on disk, their hash, and when it was last modified. Fails with `VaultFileNotFound` when it doesn't exist. */
export const readNoteSource = Effect.fnUntraced(function* (root: string, input: string) {
  const { path, absolute } = yield* resolveInVault(root, input);
  const fs = yield* FileSystem.FileSystem;
  const info = yield* fs.stat(absolute);
  if (info.type !== "File") return yield* new InvalidVaultPath({ path: input });
  const bytes = yield* fs.readFile(absolute);
  return {
    path,
    absolute,
    bytes,
    hash: sha256(bytes),
    mode: info.mode,
    modifiedAt: Option.match(info.mtime, { onNone: () => 0, onSome: (date) => date.getTime() }),
  };
});
