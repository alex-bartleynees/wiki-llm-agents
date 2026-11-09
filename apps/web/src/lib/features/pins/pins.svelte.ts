import type { Pin } from "@wiki-agents/contracts/pins/model";
import { errorMessage, isAbort } from "#lib/api/client.ts";
import { listPins, pinNote, unpinNote } from "./api.ts";

/** The open vault's pins, shared by the sidebar, the note's pin button, and the quick switcher. */
class PinsStore {
  vaultId = $state<string | undefined>(undefined);
  pins = $state<ReadonlyArray<Pin>>([]);
  /** Set when pinning or unpinning failed; cleared by the next success. */
  error = $state<string | undefined>(undefined);
  #controller: AbortController | undefined;

  /** Loads the vault's pins; `refresh` reloads the same vault (titles change, files go missing). */
  async load(vaultId: string, options: { readonly refresh?: boolean } = {}) {
    if (vaultId === this.vaultId && !options.refresh) return;
    this.#controller?.abort();
    const controller = (this.#controller = new AbortController());
    if (vaultId !== this.vaultId) this.pins = [];
    this.vaultId = vaultId;
    try {
      this.pins = (await listPins(vaultId, controller.signal)).pins;
    } catch (error) {
      if (!isAbort(error)) this.pins = [];
    }
  }

  isPinned(path: string): boolean {
    return this.pins.some((pin) => pin.path === path);
  }

  async toggle(vaultId: string, path: string) {
    this.#controller?.abort();
    try {
      const pinned = vaultId === this.vaultId && this.isPinned(path);
      const { pins } = pinned ? await unpinNote(vaultId, path) : await pinNote(vaultId, path);
      if (vaultId === this.vaultId) this.pins = pins;
      this.error = undefined;
    } catch (error) {
      this.error = errorMessage(error, "Could not change the pin");
    }
  }
}

export const pins = new PinsStore();
