import { ThreadsStreamMessage } from "@wiki-agents/contracts/threads/event";
import type { ThreadSummary } from "@wiki-agents/contracts/threads/model";
import { errorMessage, isAbort } from "#lib/api/client.ts";
import { listen } from "#lib/api/sse.ts";
import { createThread, listThreads, vaultThreadsEventsPath } from "./api.ts";
import { openThread } from "./open-thread.svelte.ts";
import { providers } from "./providers.svelte.ts";

/** The thread open in each vault, remembered on this device. */
const selectedKey = (vaultId: string) => `wiki-agents:thread:${vaultId}`;

const remembered = (vaultId: string) => {
  try {
    return localStorage.getItem(selectedKey(vaultId));
  } catch {
    return null;
  }
};

const remember = (vaultId: string, threadId: string | null) => {
  try {
    if (threadId === null) localStorage.removeItem(selectedKey(vaultId));
    else localStorage.setItem(selectedKey(vaultId), threadId);
  } catch {
    // Private mode or full storage: the open thread just won't be remembered.
  }
};

const byRecent = (a: ThreadSummary, b: ThreadSummary) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt;

/** The open vault's threads, kept current by GET /events/vaults/:id/threads. */
class ThreadsStore {
  threads = $state<ReadonlyArray<ThreadSummary>>([]);
  status = $state<"loading" | "loaded" | "failed">("loading");
  error = $state<string | undefined>(undefined);
  #vaultId: string | undefined;
  #controller: AbortController | undefined;
  #close: (() => void) | undefined;

  connect(vaultId: string) {
    if (vaultId === this.#vaultId) return;
    this.disconnect();
    this.#vaultId = vaultId;
    this.#close = listen(vaultThreadsEventsPath(vaultId), ThreadsStreamMessage, {
      onEvent: (message) => {
        if (message.type === "thread.updated" && message.thread.vaultId === this.#vaultId) this.#upsert(message.thread);
      },
      // Updates sent while disconnected are lost; reload the list.
      onReconnect: () => void this.#load(vaultId),
    });
    void this.#load(vaultId).then(() => {
      const previous = remembered(vaultId);
      if (vaultId === this.#vaultId && previous !== null && this.threads.some((thread) => thread.id === previous)) {
        void openThread.open(previous);
      }
    });
  }

  disconnect() {
    this.#controller?.abort();
    this.#close?.();
    this.#close = undefined;
    this.#vaultId = undefined;
    this.threads = [];
    this.status = "loading";
    void openThread.open(null);
  }

  select(threadId: string | null) {
    if (this.#vaultId !== undefined) remember(this.#vaultId, threadId);
    void openThread.open(threadId);
  }

  async create() {
    const vaultId = this.#vaultId;
    if (vaultId === undefined) return;
    try {
      const { thread } = await createThread(vaultId, providers.chosen?.id);
      this.#upsert(thread);
      this.select(thread.id);
      this.error = undefined;
    } catch (error) {
      this.error = errorMessage(error, "Could not start a thread");
    }
  }

  async #load(vaultId: string) {
    this.#controller?.abort();
    const controller = (this.#controller = new AbortController());
    try {
      const { threads } = await listThreads(vaultId, controller.signal);
      this.threads = threads;
      this.status = "loaded";
    } catch (error) {
      if (isAbort(error)) return;
      this.status = "failed";
      this.error = errorMessage(error, "Could not load threads");
    }
  }

  #upsert(thread: ThreadSummary) {
    this.threads = [thread, ...this.threads.filter((other) => other.id !== thread.id)].sort(byRecent);
    openThread.updated(thread);
  }
}

export const threads = new ThreadsStore();
