import { ThreadsStreamMessage } from "@wiki-agents/contracts/threads/event";
import { type ThreadActivity, type ThreadSummary, threadActivity } from "@wiki-agents/contracts/threads/model";
import { errorMessage } from "#lib/api/client.ts";
import { listen } from "#lib/api/sse.ts";
import { ALL_THREADS_TOPIC, listActiveThreads } from "./api.ts";
import { byRecent } from "./thread-order.ts";

/**
 * Every thread that is working, waiting for you, or stopped, across agents, vaults
 * and projects, kept current by the all-threads topic on the tab's event stream. The
 * layout starts it, so the header's running indicator and the Running tab's count are
 * live on every page (a topic costs no extra connection).
 */
class RunningStore {
  threads = $state<ReadonlyArray<ThreadSummary>>([]);
  status = $state<"loading" | "loaded" | "failed">("loading");
  error = $state<string | null>(null);
  #close: (() => void) | undefined;
  /** Updates that arrive while a load is under way, applied over its (older) answer. */
  #duringLoad: Map<string, ThreadSummary> | undefined;

  #group(activity: ThreadActivity) {
    const now = Date.now();
    return this.threads.filter((thread) => threadActivity(thread, now) === activity).toSorted(byRecent);
  }

  get waiting() {
    return this.#group("waiting");
  }

  get working() {
    return this.#group("working");
  }

  get stopped() {
    return this.#group("stopped");
  }

  /** Threads the Running page lists: waiting, working and stopped. */
  get count() {
    return this.waiting.length + this.working.length + this.stopped.length;
  }

  /** Loads the running threads and follows them until `stop`. */
  start() {
    if (this.#close !== undefined) return;
    this.#close = listen(ALL_THREADS_TOPIC, ThreadsStreamMessage, {
      onEvent: (message) => {
        if (message.type === "thread.updated") this.upsert(message.thread);
      },
      // Updates sent while disconnected are lost; reload.
      onReconnect: () => void this.load(),
    });
    void this.load();
  }

  stop() {
    this.#close?.();
    this.#close = undefined;
  }

  async load() {
    const updates = new Map<string, ThreadSummary>();
    this.#duringLoad = updates;
    try {
      const { threads } = await listActiveThreads();
      this.threads = threads;
      for (const thread of updates.values()) this.upsert(thread);
      this.status = "loaded";
      this.error = null;
    } catch (error) {
      this.status = "failed";
      this.error = errorMessage(error, "Could not load the running threads");
    } finally {
      if (this.#duringLoad === updates) this.#duringLoad = undefined;
    }
  }

  /** Keeps the thread while it needs showing; drops it once it doesn't. */
  upsert(thread: ThreadSummary) {
    this.#duringLoad?.set(thread.id, thread);
    const others = this.threads.filter((existing) => existing.id !== thread.id);
    this.threads = threadActivity(thread, Date.now()) === null ? others : [thread, ...others];
  }
}

export const running = new RunningStore();
