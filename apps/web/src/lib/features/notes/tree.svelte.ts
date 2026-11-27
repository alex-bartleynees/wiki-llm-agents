import type { TreeEntry } from "@wiki-agents/contracts/notes/model";
import { rankQuickSwitch } from "@wiki-agents/search/fuzzy";
import type { QuickSwitchResult } from "@wiki-agents/contracts/search/quick-switch/response";
import { errorMessage, isAbort } from "#lib/api/client.ts";
import { getTree } from "./api.ts";
import { buildTree, type TreeFolder } from "./tree.ts";

type TreeState =
  | { readonly status: "loading" }
  | {
      readonly status: "loaded";
      readonly root: TreeFolder;
      readonly count: number;
      readonly entries: ReadonlyArray<TreeEntry>;
      readonly paths: ReadonlyArray<string>;
    }
  | { readonly status: "failed"; readonly message: string };

class TreeStore {
  vaultId = $state<string | undefined>(undefined);
  state = $state<TreeState>({ status: "loading" });
  #controller: AbortController | undefined;

  async load(vaultId: string, options: { readonly refresh?: boolean } = {}) {
    const sameVault = vaultId === this.vaultId;
    if (sameVault && !options.refresh && this.state.status !== "failed") return;
    this.#controller?.abort();
    const controller = (this.#controller = new AbortController());
    this.vaultId = vaultId;
    if (!sameVault || this.state.status !== "loaded") this.state = { status: "loading" };
    try {
      const { entries } = await getTree(vaultId, controller.signal);
      this.state = { status: "loaded", root: buildTree(entries), count: entries.length, entries, paths: entries.map((entry) => entry.path) };
    } catch (error) {
      if (isAbort(error)) return;
      this.state = { status: "failed", message: errorMessage(error, "Could not load the vault") };
    }
  }

  match(vaultId: string, query: string): ReadonlyArray<QuickSwitchResult> | null {
    if (this.vaultId !== vaultId || this.state.status !== "loaded") return null;
    return rankQuickSwitch(this.state.entries, query);
  }

  hasNote(path: string): boolean {
    if (this.state.status !== "loaded") return false;
    let folder: TreeFolder | undefined = this.state.root;
    const parts = path.split("/");
    for (const part of parts.slice(0, -1)) folder = folder?.folders.find((child) => child.name === part);
    return folder?.files.some((file) => file.name === parts.at(-1)) ?? false;
  }
}

export const tree = new TreeStore();
