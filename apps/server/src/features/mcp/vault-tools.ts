import { Context, type Effect, type Scope } from "effect";

/**
 * How a provider reaches the vault tools for one thread: an MCP server entry with
 * the thread's bearer token. Never log or store it.
 */
export interface VaultToolsEntry {
  /** The entry's name in the provider, unique per thread: `wiki-agents-<thread id>`. */
  readonly name: string;
  readonly url: string;
  readonly token: string;
}

export interface VaultToolsAccess {
  /** The entry for the next turn: the same token until it nears expiry, then a new one. */
  readonly current: Effect.Effect<VaultToolsEntry>;
}

/**
 * The port the ThreadActor uses to give its provider the vault tools. Access lasts
 * as long as the scope it is opened in (the actor's); its tokens are revoked then.
 */
export interface VaultToolsService {
  readonly open: (caller: { readonly threadId: string; readonly vaultId: string }) => Effect.Effect<VaultToolsAccess, never, Scope.Scope>;
}

export class VaultTools extends Context.Service<VaultTools, VaultToolsService>()("VaultTools") {}

/** The provider's name for a thread's entry. Other threads' entries share the prefix. */
export const ENTRY_PREFIX = "wiki-agents-";
export const entryName = (threadId: string) => `${ENTRY_PREFIX}${threadId}`;
