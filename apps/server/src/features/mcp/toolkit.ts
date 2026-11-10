import { Effect, type FileSystem } from "effect";
import { Toolkit } from "effect/ai";
import type { VaultIndex } from "../indexing/vault-index.js";
import type { ThreadActors } from "../threads/thread-actors.js";
import type { VaultRepository } from "../vaults/repository.js";
import { VaultBacklinks, vaultBacklinks } from "./tools/vault-backlinks/tool.js";
import { VaultNoteInfo, vaultNoteInfo } from "./tools/vault-note-info/tool.js";
import { VaultOpenNote, vaultOpenNote } from "./tools/vault-open-note/tool.js";
import { VaultRecentChanges, vaultRecentChanges } from "./tools/vault-recent-changes/tool.js";
import { VaultResolveLink, vaultResolveLink } from "./tools/vault-resolve-link/tool.js";
import { VaultSearch, vaultSearch } from "./tools/vault-search/tool.js";
import { VaultStatus, vaultStatus } from "./tools/vault-status/tool.js";

import { VaultReadNote, vaultReadNote } from "./tools/vault-read-note/tool.js";
import { VaultRelated, vaultRelated } from "./tools/vault-related/tool.js";

/** The vault tools every agent gets, in the order they are listed. */
export const VaultToolkit = Toolkit.make(
  VaultSearch,
  VaultNoteInfo,
  VaultBacklinks,
  VaultResolveLink,
  VaultOpenNote,
  VaultRecentChanges,
  VaultStatus,
  VaultReadNote,
  VaultRelated,
);

export const VAULT_TOOL_NAMES: ReadonlyArray<string> = Object.keys(VaultToolkit.tools);

/** Services the handlers use, captured when the toolkit is built; the caller comes with each request. */
type HandlerServices = VaultIndex | VaultRepository | FileSystem.FileSystem | ThreadActors;

export const VaultToolkitLive = VaultToolkit.toLayer(
  Effect.gen(function* () {
    const services = yield* Effect.context<HandlerServices>();
    const withServices = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provideContext(effect, services) as Effect.Effect<A, E, Exclude<R, HandlerServices>>;
    return VaultToolkit.of({
      vault_read_note: (params) => withServices(vaultReadNote(params)),
      vault_related: (params) => withServices(vaultRelated(params)),
      vault_search: (params) => withServices(vaultSearch(params)),
      vault_note_info: (params) => withServices(vaultNoteInfo(params)),
      vault_backlinks: (params) => withServices(vaultBacklinks(params)),
      vault_resolve_link: (params) => withServices(vaultResolveLink(params)),
      vault_open_note: (params) => withServices(vaultOpenNote(params)),
      vault_recent_changes: (params) => withServices(vaultRecentChanges(params)),
      vault_status: () => withServices(vaultStatus(VAULT_TOOL_NAMES)),
    });
  }),
);
