import { errorMessage, isAbort } from "#lib/api/client.ts";
import { getTree } from "./api.ts";
import { buildTree, type TreeFolder } from "./tree.ts";

type TreeState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly root: TreeFolder; readonly count: number }
  | { readonly status: "failed"; readonly message: string };

/** The file tree of the open vault. */
class TreeStore {
  vaultId = $state<string | undefined>(undefined);
  state = $state<TreeState>({ status: "loading" });
  #controller: AbortController | undefined;

  /**
   * Loads the tree when the vault changes. `refresh` reloads the same vault quietly,
   * keeping the current tree on screen until the new one arrives (live updates).
   */
  async load(vaultId: string, options: { readonly refresh?: boolean } = {}) {
    const sameVault = vaultId === this.vaultId;
    if (sameVault && !options.refresh && this.state.status !== "failed") return;
    this.#controller?.abort();
    const controller = (this.#controller = new AbortController());
    this.vaultId = vaultId;
    if (!sameVault || this.state.status !== "loaded") this.state = { status: "loading" };
    try {
      const { entries } = await getTree(vaultId, controller.signal);
      this.state = { status: "loaded", root: buildTree(entries), count: entries.length };
    } catch (error) {
      if (isAbort(error)) return;
      this.state = { status: "failed", message: errorMessage(error, "Could not load the vault") };
    }
  }

  /** True when the loaded vault has a note at this path. */
  hasNote(path: string): boolean {
    if (this.state.status !== "loaded") return false;
    let folder: TreeFolder | undefined = this.state.root;
    const parts = path.split("/");
    for (const part of parts.slice(0, -1)) folder = folder?.folders.find((child) => child.name === part);
    return folder?.files.some((file) => file.name === parts.at(-1)) ?? false;
  }
}

export const tree = new TreeStore();
