import type { SecretSource, SecretStoreStatus } from "@wiki-agents/contracts/secrets/model";
import { Context, Data, type Effect } from "effect";

/** A secret as the store knows it: never its value. */
export interface SecretInfo {
  readonly name: string;
  readonly source: SecretSource;
  readonly createdAt: number | null;
  readonly expiresAt: number | null;
  readonly available: boolean;
  readonly problem: string | null;
}

export interface SecretList {
  /** By name; a declared secret hides a stored one of the same name. */
  readonly secrets: ReadonlyArray<SecretInfo>;
  readonly store: SecretStoreStatus;
  /** Declared entries that couldn't be used. */
  readonly problems: ReadonlyArray<string>;
}

/** The name or value can't be stored; each problem names its field. */
export class SecretInvalid extends Data.TaggedError("SecretInvalid")<{ readonly problems: ReadonlyArray<string> }> {}

/** The name is declared in the service's configuration, so the app can't change it. */
export class SecretDeclared extends Data.TaggedError("SecretDeclared")<{ readonly name: string; readonly path: string }> {}

/** No stored secret of this name. */
export class SecretNotFound extends Data.TaggedError("SecretNotFound")<{ readonly name: string }> {}

/** The stored secrets can't be read or written; `reason` is for the user. */
export class SecretStoreUnavailable extends Data.TaggedError("SecretStoreUnavailable")<{ readonly reason: string }> {}

/** The secret a server refers to can't be used; `reason` never contains a value. */
export class SecretUnavailable extends Data.TaggedError("SecretUnavailable")<{ readonly name: string; readonly reason: string }> {}

/**
 * Secrets by name: stored encrypted on this machine, or declared as files. Values
 * come out through `resolve` only, for the app's own connections to MCP servers;
 * no endpoint returns one.
 */
export interface SecretStoreService {
  readonly list: Effect.Effect<SecretList>;
  /** Stores `value` encrypted, replacing a stored secret of that name. */
  readonly set: (input: { readonly name: string; readonly value: string; readonly expiresAt: number | null }) => Effect.Effect<SecretInfo, SecretInvalid | SecretDeclared | SecretStoreUnavailable>;
  /** Forgets a stored secret. Needs no key, so it works when the store is unreadable. */
  readonly delete: (name: string) => Effect.Effect<void, SecretNotFound | SecretDeclared | SecretStoreUnavailable>;
  /** The value, read or decrypted now and not kept. */
  readonly resolve: (name: string) => Effect.Effect<string, SecretUnavailable>;
  /**
   * Credentials the app keeps for itself (OAuth tokens for MCP servers), encrypted
   * beside the secrets but never listed or resolvable as one. Every one whose key starts
   * with `prefix`, decrypted with one unlock; an empty map when nothing is stored.
   */
  readonly readCredentials: (prefix: string) => Effect.Effect<ReadonlyMap<string, string>, SecretStoreUnavailable>;
  /** Stores a credential, or forgets it with null (which needs no key). */
  readonly writeCredential: (key: string, value: string | null) => Effect.Effect<void, SecretStoreUnavailable>;
  /**
   * Absolute paths an agent must never reach: the stored secrets' folder, the key and
   * its systemd-encrypted copy, and every declared secret's file. Some may not exist yet.
   */
  readonly files: ReadonlyArray<string>;
  /**
   * A folder inside the stored secrets' one (so in `files`), for files holding secrets
   * the app hands a server for a moment: a browser's sign-in secrets as it starts.
   */
  readonly runDirectory: string;
}

export class SecretStore extends Context.Service<SecretStore, SecretStoreService>()("SecretStore") {}
