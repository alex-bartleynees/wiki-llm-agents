import type { ProviderInstance, ProviderStatus } from "@wiki-agents/contracts/providers/model";
import { errorMessage } from "#lib/api/client.ts";
import { getProviderStatus, listProviders } from "./api.ts";

const CHOSEN_KEY = "wiki-agents:provider";

const stored = () => {
  try {
    return localStorage.getItem(CHOSEN_KEY);
  } catch {
    return null;
  }
};

/**
 * The configured providers, which one new threads use (remembered on this device;
 * the server's default until you pick one), and whether it can run turns.
 */
class ProvidersStore {
  list = $state<ReadonlyArray<ProviderInstance>>([]);
  /** Checked on demand: checking may start the provider's server. */
  statuses = $state<Record<string, ProviderStatus | "checking">>({});
  #chosen = $state<string | null>(stored());
  #loading: Promise<void> | undefined;

  load() {
    this.#loading ??= listProviders()
      .then(({ providers }) => {
        this.list = providers;
      })
      .catch(() => {
        this.#loading = undefined;
      });
    return this.#loading;
  }

  get(id: string | undefined) {
    return this.list.find((provider) => provider.id === id);
  }

  /** The provider for new threads: your choice if it still exists, else the server's default (the first). */
  get chosen(): ProviderInstance | undefined {
    return this.get(this.#chosen ?? undefined) ?? this.list[0];
  }

  choose(id: string) {
    this.#chosen = id;
    try {
      localStorage.setItem(CHOSEN_KEY, id);
    } catch {
      // Not remembered; the choice still holds for this page.
    }
    void this.check(id);
  }

  async check(id: string) {
    if (this.statuses[id] !== undefined) return;
    this.statuses[id] = "checking";
    try {
      this.statuses[id] = (await getProviderStatus(id)).status;
    } catch (error) {
      this.statuses[id] = { _tag: "unavailable", reason: errorMessage(error, "Couldn't check the provider") };
    }
  }
}

export const providers = new ProvidersStore();
