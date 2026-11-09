import { ThreadStreamMessage } from "@wiki-agents/contracts/threads/event";
import type { RequestAnswer, ThreadSummary } from "@wiki-agents/contracts/threads/model";
import { errorMessage, isAbort } from "#lib/api/client.ts";
import { listen } from "#lib/api/sse.ts";
import { answerRequest, getThread, interruptTurn, sendMessage, threadEventsPath } from "./api.ts";
import { applyEvent, emptyTimeline, type Timeline } from "./timeline.ts";

/**
 * The thread shown in the chat pane: its events so far, then live ones over SSE
 * from the last seq. EventSource resends the last seq it saw (`Last-Event-ID`) when
 * it reconnects, and `applyEvent` skips repeats, so a dropped connection or a
 * reload mid-turn picks up exactly where it was.
 */
class OpenThreadStore {
  thread = $state<ThreadSummary | null>(null);
  timeline = $state<Timeline>(emptyTimeline());
  status = $state<"empty" | "loading" | "loaded" | "failed">("empty");
  /** Loading failed, or the last send, stop, or answer did. */
  error = $state<string | undefined>(undefined);
  /** A send is on its way; the composer waits for it. */
  sending = $state(false);
  /** Bumped for every event applied, for views that follow the end (autoscroll). */
  version = $state(0);
  #threadId: string | null = null;
  #controller: AbortController | undefined;
  #close: (() => void) | undefined;

  get threadId() {
    return this.#threadId;
  }

  get running() {
    return this.timeline.runningTurn !== null;
  }

  async open(threadId: string | null) {
    if (threadId === this.#threadId) return;
    this.close();
    this.#threadId = threadId;
    if (threadId === null) return;
    const controller = (this.#controller = new AbortController());
    this.status = "loading";
    try {
      const { thread, events } = await getThread(threadId, controller.signal);
      const timeline = emptyTimeline();
      for (const event of events) applyEvent(timeline, event);
      this.thread = thread;
      this.timeline = timeline;
      this.status = "loaded";
      this.version++;
      // A reopened stream resumes from the last event applied.
      this.#close = listen(() => threadEventsPath(threadId, this.timeline.lastSeq), ThreadStreamMessage, {
        onEvent: (message) => {
          if (message.type !== "event" || message.event.threadId !== this.#threadId) return;
          if (applyEvent(this.timeline, message.event)) this.version++;
        },
      });
    } catch (error) {
      if (isAbort(error)) return;
      this.status = "failed";
      this.error = errorMessage(error, "Could not load the thread");
    }
  }

  close() {
    this.#controller?.abort();
    this.#close?.();
    this.#close = undefined;
    this.#threadId = null;
    this.thread = null;
    this.timeline = emptyTimeline();
    this.status = "empty";
    this.error = undefined;
    this.sending = false;
  }

  /** Updates the summary (title, status) from the thread list's stream. */
  updated(thread: ThreadSummary) {
    if (thread.id === this.#threadId) this.thread = thread;
  }

  async send(text: string): Promise<boolean> {
    const threadId = this.#threadId;
    if (threadId === null || this.sending) return false;
    this.sending = true;
    try {
      await sendMessage(threadId, text);
      this.error = undefined;
      return true;
    } catch (error) {
      this.error = errorMessage(error, "Could not send the message");
      return false;
    } finally {
      this.sending = false;
    }
  }

  async stop() {
    await this.#act(interruptTurn, "Could not stop the turn");
  }

  async answer(requestId: string, answer: RequestAnswer) {
    await this.#act((threadId) => answerRequest(threadId, requestId, answer), "Could not send the answer");
  }

  async #act(action: (threadId: string) => Promise<unknown>, failure: string) {
    const threadId = this.#threadId;
    if (threadId === null) return;
    try {
      await action(threadId);
      this.error = undefined;
    } catch (error) {
      this.error = errorMessage(error, failure);
    }
  }
}

export const openThread = new OpenThreadStore();
