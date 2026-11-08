import type { Vault } from "@wiki-agents/contracts/vaults/model";
import { listVaults } from "./api.ts";

type VaultsState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly vaults: ReadonlyArray<Vault> }
  | { readonly status: "failed"; readonly message: string };

class VaultsStore {
  state = $state<VaultsState>({ status: "loading" });

  async load() {
    this.state = { status: "loading" };
    try {
      const { vaults } = await listVaults();
      this.state = { status: "loaded", vaults };
    } catch (error) {
      this.state = {
        status: "failed",
        message: error instanceof Error ? error.message : "Could not load vaults",
      };
    }
  }
}

export const vaults = new VaultsStore();
