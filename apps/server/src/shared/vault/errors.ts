import { Data } from "effect";

export class VaultNotFound extends Data.TaggedError("VaultNotFound")<{
  readonly vaultId: string;
}> {}

/** The path is malformed, escapes the vault (`..`, symlinks), or is in the ignore list. */
export class InvalidVaultPath extends Data.TaggedError("InvalidVaultPath")<{
  readonly path: string;
}> {}

export class VaultFileNotFound extends Data.TaggedError("VaultFileNotFound")<{
  readonly path: string;
}> {}
