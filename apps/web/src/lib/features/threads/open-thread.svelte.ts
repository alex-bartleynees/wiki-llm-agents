import { goto } from "$app/navigation";
import { shell } from "#lib/ui/layout/shell.svelte.ts";
import { ThreadStreamMessage } from "@wiki-agents/contracts/threads/event";
import type { RequestAnswer, ThreadSummary } from "@wiki-agents/contracts/threads/model";
import { ApiError, errorMessage, isAbort } from "#lib/api/client.ts";
import { listen } from "#lib/api/sse.ts";
import type { SendMessageRequest } from "@wiki-agents/contracts/threads/send-message/request";
import { answerRequest, compactContext, getThread, interruptTurn, type MessageFiles, requestHandoff, sendMessage, threadTopic } from "./api.ts";
import { applyEvent, emptyTimeline, subagentsWorking, type Timeline } from "./timeline.ts";

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

  /** Subagents still at work, which Stop stops too; they can be while the agent itself is idle. */
  get subagentsWorking() {
    return subagentsWorking(this.timeline);
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
      if (controller.signal.aborted || threadId !== this.#threadId) return;
      const timeline = emptyTimeline();
      for (const event of events) applyEvent(timeline, event);
      this.thread = thread;
      this.timeline = timeline;
      this.status = "loaded";
      this.version++;
      // A reopened stream resumes from the last event applied.
      this.#close = listen(() => threadTopic(threadId, this.timeline.lastSeq), ThreadStreamMessage, {
        onEvent: (message) => {
          if (message.type !== "event" || message.event.threadId !== this.#threadId) return;
          if (applyEvent(this.timeline, message.event)) {
            this.version++;
            if (message.event.event._tag === "note.opened") {
              void goto(message.event.event.href);
              shell.tab = "wiki";
            }
          }
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
    this.compacting = false;
    this.handingOff = false;
  }

  /** Updates the summary (title, status) from the thread list's stream. */
  updated(thread: ThreadSummary) {
    if (thread.id === this.#threadId) this.thread = thread;
  }

  async send(text: string, notes: SendMessageRequest["notes"] = [], files: MessageFiles = {}): Promise<boolean> {
    const threadId = this.#threadId;
    if (threadId === null || this.sending) return false;
    this.sending = true;
    try {
      await sendMessage(threadId, text, notes, files);
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

  /** Compact conversation is on its way; the button waits for it. */
  compacting = $state(false);
  /**
   * The operation id of a compaction whose request got no answer (the network, say):
   * the next click sends it again, so the server starts it at most once.
   */
  #unanswered: { readonly threadId: string; readonly operationId: string } | undefined;

  async compact() {
    const threadId = this.#threadId;
    if (threadId === null || this.compacting) return;
    const operationId = this.#unanswered?.threadId === threadId ? this.#unanswered.operationId : crypto.randomUUID();
    this.#unanswered = { threadId, operationId };
    this.compacting = true;
    try {
      await compactContext(threadId, operationId);
      this.#unanswered = undefined;
      this.error = undefined;
    } catch (error) {
      // The server answered (busy, nothing to compact): that click is settled.
      if (error instanceof ApiError) this.#unanswered = undefined;
      this.error = errorMessage(error, "Could not compact the conversation");
    } finally {
      this.compacting = false;
    }
  }

  /** Asking for a handoff is on its way; the button waits for it. */
  handingOff = $state(false);
  /** As for `compact`: a request that got no answer is sent again with the same id. */
  #unansweredHandoff: { readonly threadId: string; readonly operationId: string } | undefined;

  /** Asks the agent to write a handoff, as a turn in this thread; the reply arrives on the stream. */
  async handoff() {
    const threadId = this.#threadId;
    if (threadId === null || this.handingOff) return;
    const operationId = this.#unansweredHandoff?.threadId === threadId ? this.#unansweredHandoff.operationId : crypto.randomUUID();
    this.#unansweredHandoff = { threadId, operationId };
    this.handingOff = true;
    try {
      await requestHandoff(threadId, operationId);
      this.#unansweredHandoff = undefined;
      this.error = undefined;
    } catch (error) {
      if (error instanceof ApiError) this.#unansweredHandoff = undefined;
      this.error = errorMessage(error, "Could not ask for a handoff");
    } finally {
      this.handingOff = false;
    }
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
