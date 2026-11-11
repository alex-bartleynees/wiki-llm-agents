import { createHash } from "node:crypto";
import { Effect, FileSystem, Option } from "effect";
import { InvalidVaultPath } from "../../shared/vault/errors.js";
import { resolveInVault, resolveNewInVault } from "../../shared/vault/path-guard.js";
import { findVault } from "../vaults/find-vault.js";
import { ChangeLog } from "./change-log.js";
import { ChangeNotFound } from "./errors.js";

export const sha256 = (content: string | Uint8Array) => createHash("sha256").update(content).digest("hex");

/** A recorded change, its vault, where the file is, and what is on disk there now. */
export const findChange = Effect.fnUntraced(function* (changeId: string) {
  const record = Option.getOrUndefined(yield* (yield* ChangeLog).find(changeId));
  if (record === undefined) return yield* new ChangeNotFound({ changeId });
  const vault = yield* findVault(record.vaultId);
  const fs = yield* FileSystem.FileSystem;
  const existing = yield* resolveInVault(vault.rootPath, record.path).pipe(
    Effect.map(Option.some),
    Effect.catchTag("VaultFileNotFound", () => Effect.succeed(Option.none())),
  );
  const absolute = Option.isSome(existing) ? existing.value.absolute : yield* resolveNewInVault(vault.rootPath, record.path);
  const bytes = Option.isSome(existing) ? yield* fs.readFile(absolute).pipe(Effect.option) : Option.none();
  if (Option.isSome(existing)) {
    const info = yield* fs.stat(absolute);
    if (info.type !== "File") return yield* new InvalidVaultPath({ path: record.path });
  }
  const current = Option.map(bytes, (value) => ({ hash: sha256(value), content: new TextDecoder().decode(value) }));
  return { record, vault, absolute, current: Option.getOrNull(current) };
});
