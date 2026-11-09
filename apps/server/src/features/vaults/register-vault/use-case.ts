import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import type { RegisterVaultRequest } from "@wiki-agents/contracts/vaults/register-vault/request";
import { Clock, Data, Effect, FileSystem, Option } from "effect";
import { trackVault } from "../../indexing/track-vault.js";
import { VaultRepository } from "../repository.js";

export class InvalidVaultFolder extends Data.TaggedError("InvalidVaultFolder")<{
  readonly rootPath: string;
  readonly reason: string;
}> {}

const expandHome = (path: string) =>
  path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;

/**
 * Registers a folder as a vault, by its canonical path (symlinks resolved), so the
 * same folder can't be added twice. Registering an existing folder returns it.
 * Waits for the first index scan, so the vault's tree is complete on return; a scan
 * that fails is logged and doesn't undo the registration.
 */
export const registerVault = Effect.fn("registerVault")(function* (request: RegisterVaultRequest) {
  const requested = expandHome(request.rootPath.trim());
  if (!isAbsolute(requested)) {
    return yield* new InvalidVaultFolder({ rootPath: request.rootPath, reason: "Use an absolute path" });
  }
  const fs = yield* FileSystem.FileSystem;
  const rootPath = yield* fs.realPath(requested).pipe(
    Effect.catchReason("PlatformError", "NotFound", () =>
      Effect.fail(new InvalidVaultFolder({ rootPath: request.rootPath, reason: "Folder not found" })),
    ),
  );
  const info = yield* fs.stat(rootPath);
  if (info.type !== "Directory") {
    return yield* new InvalidVaultFolder({ rootPath: request.rootPath, reason: "Not a folder" });
  }

  const repository = yield* VaultRepository;
  const existing = yield* repository.findByRootPath(rootPath);
  const vault = Option.isSome(existing)
    ? existing.value
    : { id: randomUUID(), name: request.name?.trim() || basename(rootPath), rootPath };
  if (Option.isNone(existing)) {
    yield* repository.insert({ ...vault, createdAt: new Date(yield* Clock.currentTimeMillis) });
  }
  yield* trackVault(vault).pipe(Effect.catchTag("IndexFailed", (error) => Effect.logWarning("first index scan failed", error)));
  return { vault, created: Option.isNone(existing) };
});
