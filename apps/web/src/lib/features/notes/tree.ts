import type { TreeEntry } from "@wiki-agents/contracts/notes/model";

export interface TreeFolder {
  readonly name: string;
  /** Vault-relative path; "" for the vault root. */
  readonly path: string;
  readonly folders: Array<TreeFolder>;
  readonly files: Array<TreeEntry & { readonly name: string }>;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Builds folders from flat paths: folders first, then files, in natural order (`2` before `10`). */
export const buildTree = (entries: ReadonlyArray<TreeEntry>): TreeFolder => {
  const root: TreeFolder = { name: "", path: "", folders: [], files: [] };
  const folders = new Map<string, TreeFolder>([["", root]]);
  const folderFor = (path: string): TreeFolder => {
    const existing = folders.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf("/");
    const parent = folderFor(slash === -1 ? "" : path.slice(0, slash));
    const folder: TreeFolder = { name: path.slice(slash + 1), path, folders: [], files: [] };
    parent.folders.push(folder);
    folders.set(path, folder);
    return folder;
  };
  for (const entry of entries) {
    const slash = entry.path.lastIndexOf("/");
    folderFor(slash === -1 ? "" : entry.path.slice(0, slash)).files.push({
      ...entry,
      name: entry.path.slice(slash + 1),
    });
  }
  for (const folder of folders.values()) {
    folder.folders.sort((a, b) => collator.compare(a.name, b.name));
    folder.files.sort((a, b) => collator.compare(a.name, b.name));
  }
  return root;
};

/** `a/b/c.md` → `["a", "a/b"]`: the folders to expand to show a file. */
export const ancestorsOf = (path: string): ReadonlyArray<string> => {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
};
