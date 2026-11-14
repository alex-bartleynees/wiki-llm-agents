import { VaultEvent } from "@wiki-agents/contracts/indexing/event";
import { SvelteMap } from "svelte/reactivity";
import { listen } from "#lib/api/sse.ts";

/**
 * Live changes in the open vault, from the vault topic on the event stream. Views read
 * `revision` (anything changed) or `versionOf(path)` (that file changed) in an effect
 * and reload when it moves.
 */
class VaultEventsStore {
  /** Bumped on every change, and after a reconnect. */
  revision = $state(0);
  /** Bumped after a reconnect: changes may have been missed, so everything is stale. */
  #reconnects = $state(0);
  readonly #versions = new SvelteMap<string, number>();
  #vaultId: string | undefined;
  #close: (() => void) | undefined;

  connect(vaultId: string) {
    if (vaultId === this.#vaultId) return;
    this.disconnect();
    this.#vaultId = vaultId;
    this.#close = listen({ type: "vault", vaultId }, VaultEvent, {
      onEvent: (event) => {
        if (event.type !== "vault.changed" || event.vaultId !== this.#vaultId) return;
        for (const path of event.paths) this.#versions.set(path, (this.#versions.get(path) ?? 0) + 1);
        this.revision++;
      },
      onReconnect: () => {
        this.#reconnects++;
        this.revision++;
      },
    });
  }

  disconnect() {
    this.#close?.();
    this.#close = undefined;
    this.#vaultId = undefined;
    this.#versions.clear();
  }

  /** Changes when this file changed on disk, or after a reconnect. */
  versionOf(path: string): string {
    return `${this.#versions.get(path) ?? 0}:${this.#reconnects}`;
  }
}

export const vaultEvents = new VaultEventsStore();
