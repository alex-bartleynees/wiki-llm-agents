import type { BrowserSignIn } from "@wiki-agents/contracts/projects/model";
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
  /**
   * Goes up when the thread's tools from other MCP servers change (see `gateway.ts`).
   * Providers list an entry's tools only when it is registered, so a new revision comes
   * with a new token, which makes every adapter register it again. OpenCode also needs a
   * new name: `revisedEntryName`.
   */
  readonly revision: number;
}

/** What the next turn gets: the entry, and what the user should know about its tools. */
export interface VaultToolsTurn {
  readonly entry: VaultToolsEntry;
  /** Other MCP servers down or missing, tools held back; empty when nothing changed since the last turn. */
  readonly notices: ReadonlyArray<string>;
}

/** What the thread's project adds to its tools, as it is now. */
export interface ProjectTools {
  /** MCP servers every thread in the project gets, whatever its agent. */
  readonly servers: ReadonlyArray<string>;
  /** Browser sign-ins: a browser that takes them is restarted with them when they change. */
  readonly signIns: ReadonlyArray<BrowserSignIn>;
}

/** A thread outside any project. */
export const NO_PROJECT_TOOLS: ProjectTools = { servers: [], signIns: [] };

export interface VaultToolsAccess {
  /**
   * The entry for the next turn, with the tools of the servers every thread gets, of
   * `agentServers` and of the project's servers: the same token until it nears expiry
   * or the tools change, then a new one.
   */
  readonly current: (agentServers: ReadonlyArray<string>, project?: ProjectTools) => Effect.Effect<VaultToolsTurn>;
}

/** The thread whose tools these are, and where its upstream connections run (see `McpScopeContext`). */
export interface VaultToolsCaller {
  readonly threadId: string;
  readonly vaultId: string;
  /** Null (or left out) for a thread outside any project. */
  readonly projectId?: string | null;
  /** The project's main working directory, or the vault's folder. */
  readonly cwd?: string | null;
}

/**
 * The port the ThreadActor uses to give its provider the vault tools. Access lasts
 * as long as the scope it is opened in (the actor's); its tokens are revoked then.
 */
export interface VaultToolsService {
  readonly open: (caller: VaultToolsCaller) => Effect.Effect<VaultToolsAccess, never, Scope.Scope>;
}

export class VaultTools extends Context.Service<VaultTools, VaultToolsService>()("VaultTools") {}

/** The provider's name for a thread's entry. Other threads' entries share the prefix. */
export const ENTRY_PREFIX = "wiki-agents-";
export const entryName = (threadId: string) => `${ENTRY_PREFIX}${threadId}`;

/**
 * The entry's name with its revision, for a provider that keeps an entry's first tool
 * list for as long as the name is registered (OpenCode): `wiki-agents-<thread id>-2`.
 * Revision 0 keeps the plain name.
 */
export const revisedEntryName = (entry: VaultToolsEntry) => (entry.revision === 0 ? entry.name : `${entry.name}-${entry.revision}`);

/**
 * The tools that write notes. The server checks the agent's live create/edit autonomy
 * and asks with the exact diff itself, so providers let them through.
 */
export const VAULT_WRITE_TOOLS: ReadonlyArray<string> = ["vault_create_note", "vault_edit_note"];

/**
 * Other MCP servers' tools on the entry, `<server>__<tool>` (see `gateway.ts`). The
 * server checks each call against the agent's autonomy and asks itself, so providers
 * let them through too. The app's own tools never have `__` in their names.
 */
export const isGatewayTool = (tool: string) => tool.includes("__");
export const GATEWAY_TOOL_PATTERN = "*__*";

/** Tools on the entry that the app's server decides on, not the provider. */
export const serverDecides = (tool: string) => VAULT_WRITE_TOOLS.includes(tool) || isGatewayTool(tool);
