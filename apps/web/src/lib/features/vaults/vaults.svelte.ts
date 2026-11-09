import type { Vault } from "@wiki-agents/contracts/vaults/model";
import { errorMessage } from "#lib/api/client.ts";
import { listVaults, registerVault } from "./api.ts";

type VaultsState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly vaults: ReadonlyArray<Vault> }
  | { readonly status: "failed"; readonly message: string };

const LAST_VAULT_KEY = "wiki-agents:last-vault";

class VaultsStore {
  state = $state<VaultsState>({ status: "loading" });
  #loading: Promise<void> | undefined;

  /** Loads once; later calls reuse the result unless `force` is set. */
  load(force = false): Promise<void> {
    if (this.#loading && !force) return this.#loading;
    this.#loading = (async () => {
      if (this.state.status !== "loaded") this.state = { status: "loading" };
      try {
        const { vaults } = await listVaults();
        this.state = { status: "loaded", vaults };
      } catch (error) {
        this.state = { status: "failed", message: errorMessage(error, "Could not load vaults") };
        this.#loading = undefined;
      }
    })();
    return this.#loading;
  }

  get list(): ReadonlyArray<Vault> {
    return this.state.status === "loaded" ? this.state.vaults : [];
  }

  byId(id: string | undefined): Vault | undefined {
    return this.list.find((vault) => vault.id === id);
  }

  /** The vault opened last on this device, else the first. */
  get preferred(): Vault | undefined {
    const last = localStorage.getItem(LAST_VAULT_KEY) ?? undefined;
    return this.byId(last) ?? this.list[0];
  }

  remember(id: string) {
    localStorage.setItem(LAST_VAULT_KEY, id);
  }

  async register(rootPath: string, name: string): Promise<Vault> {
    const { vault } = await registerVault({ rootPath, ...(name.trim() ? { name: name.trim() } : {}) });
    await this.load(true);
    return vault;
  }
}

export const vaults = new VaultsStore();
