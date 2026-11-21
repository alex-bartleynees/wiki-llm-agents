import type { ListProviderModelsResponse } from "@wiki-agents/contracts/providers/list-provider-models/response";
import { SvelteMap } from "svelte/reactivity";
import { errorMessage } from "#lib/api/client.ts";
import { listProviderModels } from "./api.ts";

type Discovery =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly result: ListProviderModelsResponse }
  | { readonly status: "failed"; readonly message: string };

export class ModelDiscovery {
  #entries = new SvelteMap<string, Discovery>();
  #requests = new Map<string, AbortController>();

  get(id: string | undefined): Discovery | undefined {
    return id === undefined ? undefined : this.#entries.get(id);
  }

  load(id: string, retryFailed = false) {
    const entry = this.#entries.get(id);
    if (this.#requests.has(id) || (entry !== undefined && !(retryFailed && entry.status === "failed"))) return;
    const controller = new AbortController();
    this.#requests.set(id, controller);
    this.#entries.set(id, { status: "loading" });
    void listProviderModels(id, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) this.#entries.set(id, { status: "ready", result });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) this.#entries.set(id, { status: "failed", message: errorMessage(error, "Couldn't load models.") });
      },
    ).finally(() => this.#requests.delete(id));
  }

  close() {
    for (const request of this.#requests.values()) request.abort();
  }
}
