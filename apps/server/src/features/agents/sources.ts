import type { Autonomy, KnowledgeSource } from "@wiki-agents/contracts/agents/model";

/**
 * What an agent's knowledge sources let the vault tools reach in one vault:
 * - `all`: the whole vault
 * - `folders`: only notes in these folders (vault-relative, no trailing `/`)
 * - `none`: nothing; the vault isn't among its sources
 */
export type VaultScope =
  | { readonly _tag: "all" }
  | { readonly _tag: "folders"; readonly folders: ReadonlyArray<string> }
  | { readonly _tag: "none" };

export const WHOLE_VAULT: VaultScope = { _tag: "all" };

/**
 * The scope in the vault named `vaultName`. No sources means no limits; `vault`
 * means whichever vault the thread works in; a named vault with no folders is the
 * whole of it. Several entries for the same vault add up.
 */
export const vaultScope = (sources: ReadonlyArray<KnowledgeSource>, vaultName: string): VaultScope => {
  if (sources.length === 0 || sources.includes("vault")) return WHOLE_VAULT;
  const folders = new Set<string>();
  for (const source of sources) {
    if (typeof source === "string" || source.vault !== vaultName) continue;
    if (source.folders.length === 0) return WHOLE_VAULT;
    for (const folder of source.folders) folders.add(folder);
  }
  return folders.size === 0 ? { _tag: "none" } : { _tag: "folders", folders: [...folders].sort() };
};

/** True when `path` (vault-relative) is inside the scope. */
export const inScope = (scope: VaultScope, path: string): boolean => {
  switch (scope._tag) {
    case "all":
      return true;
    case "none":
      return false;
    case "folders":
      return scope.folders.some((folder) => path === folder || path.startsWith(`${folder}/`));
  }
};

/** The web is a source unless sources are listed without it. */
export const webAllowed = (sources: ReadonlyArray<KnowledgeSource>) => sources.length === 0 || sources.includes("web");

/** The autonomy providers are given: the file's, with the web denied when it isn't a source. */
export const effectiveAutonomy = (agent: { readonly autonomy: Autonomy; readonly sources: ReadonlyArray<KnowledgeSource> }): Autonomy =>
  webAllowed(agent.sources) ? agent.autonomy : { ...agent.autonomy, web: "deny" };

/** Why the web is off for an agent whose file allows it, for the agent screen. */
export const WEB_NOT_A_SOURCE = "The web isn't among the agent's sources, so it is denied.";
