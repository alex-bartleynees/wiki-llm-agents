import type { TreeEntry } from "@wiki-agents/contracts/notes/model";

/**
 * The folders directly inside `folder` (vault-relative, "" for the root), from the
 * vault's file paths: a folder exists here when a file is somewhere inside it.
 */
export const foldersInside = (entries: ReadonlyArray<Pick<TreeEntry, "path">>, folder: string) => {
  const prefix = folder === "" ? "" : `${folder}/`;
  const names = new Set<string>();
  for (const { path } of entries) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length).split("/");
    if (rest.length > 1 && rest[0] !== "") names.add(rest[0]!);
  }
  return [...names]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }))
    .map((name) => ({ name, path: prefix + name }));
};

/** The folder above a vault-relative folder; null at the root. */
export const parentFolder = (folder: string) => (folder === "" ? null : folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "");
