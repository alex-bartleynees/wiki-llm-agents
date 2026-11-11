import { ThreadsStreamMessage } from "@wiki-agents/contracts/threads/event";
import type { ThreadSummary } from "@wiki-agents/contracts/threads/model";
import { errorMessage, isAbort } from "#lib/api/client.ts";
import { listen } from "#lib/api/sse.ts";
import { agents } from "#lib/features/agents/agents.svelte.ts";
import { projects } from "#lib/features/projects/projects.svelte.ts";
import { createThread, getThread, listThreads, markDone, reopenThread, vaultThreadsEventsPath } from "./api.ts";
import { openThread } from "./open-thread.svelte.ts";
import { providers } from "./providers.svelte.ts";
import { byRecent, doneThreads, openThreads } from "./thread-order.ts";
import { inScope, rememberedThreadKey, sameScope, type ThreadScope } from "./thread-scope.ts";

/** The thread open in each scope, remembered on this device. */
const remembered = (scope: ThreadScope) => {
  try {
    return localStorage.getItem(rememberedThreadKey(scope));
  } catch {
    return null;
  }
};

const remember = (scope: ThreadScope, threadId: string | null) => {
  try {
    if (threadId === null) localStorage.removeItem(rememberedThreadKey(scope));
    else localStorage.setItem(rememberedThreadKey(scope), threadId);
  } catch {
    // Private mode or full storage: the open thread just won't be remembered.
  }
};

/**
 * The threads of the open scope (all of a vault's, or one project's), kept current
 * by GET /events/vaults/:id/threads.
 */
class ThreadsStore {
  threads = $state<ReadonlyArray<ThreadSummary>>([]);
  /** Threads not marked done, most recently updated first. */
  open = $derived(openThreads(this.threads));
  /** Threads marked done, most recently marked first. */
  done = $derived(doneThreads(this.threads));
  /** Whether the thread list shows its Done group; kept while you look at a thread. */
  showDone = $state(false);
  status = $state<"loading" | "loaded" | "failed">("loading");
  error = $state<string | undefined>(undefined);
  #scope: ThreadScope | undefined;
  #controller: AbortController | undefined;
  #close: (() => void) | undefined;

  /**
   * Follows a scope's threads (a scope already followed is left as it is). Settles
   * once the list has loaded and the scope's remembered thread is open.
   */
  connect(scope: ThreadScope): Promise<void> {
    if (sameScope(scope, this.#scope)) return Promise.resolve();
    this.disconnect();
    this.#scope = scope;
    this.#close = listen(vaultThreadsEventsPath(scope.vaultId), ThreadsStreamMessage, {
      onEvent: (message) => {
        if (message.type === "thread.updated" && inScope(this.#scope, message.thread)) this.#upsert(message.thread);
      },
      // Updates sent while disconnected are lost; reload the list.
      onReconnect: () => void this.#load(scope),
    });
    return this.#load(scope).then(async () => {
      const previous = remembered(scope);
      if (this.#scope === scope && previous !== null && this.threads.some((thread) => thread.id === previous)) {
        await openThread.open(previous);
      }
    });
  }

  disconnect() {
    this.#controller?.abort();
    this.#close?.();
    this.#close = undefined;
    this.#scope = undefined;
    this.threads = [];
    this.status = "loading";
    void openThread.open(null);
  }

  /**
   * Opens a thread. One outside the project being shown (a note's linked thread)
   * switches the list to its project, or to all threads; one from another vault
   * can't be opened here.
   */
  async select(threadId: string | null) {
    if (threadId !== null && !this.threads.some((thread) => thread.id === threadId)) {
      try {
        const { thread } = await getThread(threadId);
        if (thread.vaultId !== this.#scope?.vaultId) {
          this.error = "That thread is in another vault; open that vault to see it.";
          return;
        }
        projects.select(thread.projectId);
        this.connect({ vaultId: thread.vaultId, projectId: thread.projectId });
      } catch (error) {
        this.error = errorMessage(error, "Could not open thread");
        return;
      }
    }
    if (this.#scope !== undefined) remember(this.#scope, threadId);
    await openThread.open(threadId);
  }

  /** Starts a thread in the list being shown. */
  async create() {
    const scope = this.#scope;
    if (scope === undefined) return;
    try {
      const thread = await this.startIn(scope);
      this.error = undefined;
      return thread;
    } catch (error) {
      this.error = errorMessage(error, "Could not start a thread");
    }
  }

  /**
   * Starts a thread in `scope` with the chosen agent and provider, and makes it the
   * scope's open thread. Fails with why it couldn't.
   */
  async startIn(scope: ThreadScope) {
    const agentId = agents.chosen?.id;
    const providerInstanceId = providers.chosen?.id;
    const { thread } = await createThread(scope.vaultId, {
      ...(scope.projectId === null ? {} : { projectId: scope.projectId }),
      ...(providerInstanceId === undefined ? {} : { providerInstanceId }),
      ...(agentId === undefined ? {} : { agentId }),
    });
    if (sameScope(scope, this.#scope)) this.#upsert(thread);
    await this.show(scope, thread.id);
    return thread;
  }

  /** Makes a thread the scope's open one: now if the scope is showing, else when it next shows. */
  async show(scope: ThreadScope, threadId: string) {
    remember(scope, threadId);
    if (sameScope(scope, this.#scope)) await openThread.open(threadId);
  }

  /**
   * Marks a thread done, or reopens it. The thread stays open in the chat pane; a
   * failure (a turn started meanwhile) shows there.
   */
  async setDone(threadId: string, done: boolean) {
    try {
      const { thread } = await (done ? markDone(threadId) : reopenThread(threadId));
      if (inScope(this.#scope, thread)) this.#upsert(thread);
      else openThread.updated(thread);
      openThread.error = undefined;
    } catch (error) {
      openThread.error = errorMessage(error, done ? "Could not mark the thread done" : "Could not reopen the thread");
    }
  }

  async #load(scope: ThreadScope) {
    this.#controller?.abort();
    const controller = (this.#controller = new AbortController());
    try {
      const { threads } = await listThreads(scope.vaultId, scope.projectId, controller.signal);
      if (this.#scope !== scope) return;
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
