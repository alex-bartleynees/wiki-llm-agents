/** Which threads the threads pane shows: all of a vault's, or one project's. */
export interface ThreadScope {
  readonly vaultId: string;
  /** Null for every thread in the vault, whatever its project. */
  readonly projectId: string | null;
}

export const sameScope = (a: ThreadScope | undefined, b: ThreadScope | undefined) =>
  a?.vaultId === b?.vaultId && a?.projectId === b?.projectId;

/** Whether a thread belongs in the scope's list. */
export const inScope = (scope: ThreadScope | undefined, thread: { readonly vaultId: string; readonly projectId: string | null }) =>
  scope !== undefined && thread.vaultId === scope.vaultId && (scope.projectId === null || thread.projectId === scope.projectId);

/** Where the open thread is remembered; a vault's list keeps the key it had before projects. */
export const rememberedThreadKey = (scope: ThreadScope) =>
  scope.projectId === null ? `wiki-agents:thread:${scope.vaultId}` : `wiki-agents:thread:${scope.vaultId}:project:${scope.projectId}`;

/**
 * The project to show with a vault: the selected one, when it uses that vault. With
 * another vault open, all of that vault's threads show instead.
 */
export const projectShownWith = (vaultId: string, selected: { readonly id: string; readonly vaultId: string } | null) =>
  selected !== null && selected.vaultId === vaultId ? selected.id : null;
