import type { RequestAnswer, RequestPrompt, StoredThreadEvent, ThreadEvent } from "@wiki-agents/contracts/threads/model";
import { Effect, Option, PubSub } from "effect";
import { WallClock } from "../../shared/wall-clock.js";
import { finalReply } from "../threads/final-reply.js";
import { ThreadRepository } from "../threads/repository.js";
import { ThreadBus } from "../threads/thread-bus.js";
import { Inbox } from "./inbox.js";
import { InboxRepository, type NewInboxItem } from "./repository.js";

/** How much of a turn's reply its inbox item shows; the thread has the rest. */
const PREVIEW = 600;

const preview = (text: string) => (text.length > PREVIEW ? `${text.slice(0, PREVIEW - 1)}…` : text);

const requestItem = (prompt: RequestPrompt): Pick<NewInboxItem, "title" | "body"> =>
  prompt._tag === "approval"
    ? { title: `Approve: ${prompt.title}`, body: prompt.edits === undefined ? prompt.detail : prompt.edits.map((edit) => edit.path).join("\n") }
    : { title: `Question: ${prompt.question}`, body: prompt.options.map((option) => `- ${option}`).join("\n") };

const resolution = (answer: RequestAnswer | null) =>
  answer === null ? "Cancelled" : answer._tag === "question" ? "Answered" : answer.decision === "approve" ? "Approved" : "Denied";

/**
 * Turns thread events into inbox items, so everything waiting for you is in one
 * place: an approval or question waiting (done once answered), and each thread's
 * latest turn result (done when you send it another message). Scheduled runs are
 * left out: their schedule puts the result in the inbox itself.
 *
 * Subscribes, then returns the work to run in the background: reconciling with the
 * requests still pending, then following events; nothing in between is missed.
 */
export const watchThreadEvents = Effect.gen(function* () {
  const threads = yield* ThreadRepository;
  const repository = yield* InboxRepository;
  const inbox = yield* Inbox;
  const clock = yield* WallClock;
  const subscription = yield* (yield* ThreadBus).subscribeEvents;

  const threadOf = (threadId: string) => Effect.map(threads.find(threadId), Option.getOrUndefined);
  const attended = (turnId: string) => Effect.map(threads.findTurn(turnId), (turn) => Option.isSome(turn) && !turn.value.unattended);

  const opened = Effect.fnUntraced(function* (threadId: string, turnId: string, requestId: string, prompt: RequestPrompt) {
    if (Option.isSome(yield* repository.findOpenRequest(requestId))) return;
    const thread = yield* threadOf(threadId);
    yield* inbox.add({ kind: "request", ...requestItem(prompt), source: { vaultId: thread?.vaultId ?? null, threadId, turnId, requestId } });
  });

  const handle = Effect.fnUntraced(function* ({ threadId, event }: StoredThreadEvent) {
    switch (event._tag) {
      case "request.opened":
        if (yield* attended(event.turnId)) yield* opened(threadId, event.turnId, event.requestId, event.prompt);
        return;
      case "request.resolved": {
        const item = yield* repository.findOpenRequest(event.requestId);
        if (Option.isNone(item)) return;
        const done = yield* repository.setState(item.value.id, "done", yield* clock.now, resolution(event.answer));
        if (Option.isSome(done)) yield* inbox.publish([done.value]);
        return;
      }
      case "user.message":
        if (event.unattended === true) return;
        yield* inbox.publish(yield* repository.closeTurnItems(threadId, yield* clock.now));
        return;
      case "turn.finished": {
        // Stopped by you: nothing to tell you.
        if (event.outcome === "interrupted" && event.reason === null) return;
        if (!(yield* attended(event.turnId))) return;
        const thread = yield* threadOf(threadId);
        const name = thread?.title ?? "Untitled thread";
        const item = yield* finishedItem(threadId, event, name);
        yield* repository.putTurnItem(threadId, { ...item, source: { vaultId: thread?.vaultId ?? null, threadId, turnId: event.turnId } }, inbox.channels, yield* clock.now);
        yield* inbox.wake;
        return;
      }
    }
  });

  const finishedItem = Effect.fnUntraced(function* (
    threadId: string,
    event: Extract<ThreadEvent, { readonly _tag: "turn.finished" }>,
    name: string,
  ) {
    if (event.outcome === "completed") {
      const reply = finalReply((yield* threads.events(threadId, 0)).map((stored) => stored.event), event.turnId);
      return { kind: "turn.finished" as const, title: `Finished: ${name}`, body: preview(reply) };
    }
    const verb = event.outcome === "failed" ? "Failed" : "Stopped";
    return { kind: "turn.failed" as const, title: `${verb}: ${name}`, body: event.reason ?? "The turn didn't finish." };
  });

  // Requests that opened or closed while nothing was listening (the server stopped in between).
  const reconcile = Effect.gen(function* () {
    const pending = yield* threads.openRequests;
    const pendingIds = new Set(pending.map((request) => request.requestId));
    for (const requestId of yield* repository.openRequestIds) {
      if (pendingIds.has(requestId)) continue;
      const item = yield* repository.findOpenRequest(requestId);
      if (Option.isNone(item)) continue;
      const done = yield* repository.setState(item.value.id, "done", yield* clock.now, "Closed");
      if (Option.isSome(done)) yield* inbox.publish([done.value]);
    }
    for (const request of pending) if (!request.unattended) yield* opened(request.threadId, request.turnId, request.requestId, request.prompt);
  });

  const consume = PubSub.take(subscription).pipe(
    Effect.flatMap((stored) => handle(stored).pipe(Effect.catch((error) => Effect.logError(`inbox: can't record ${stored.event._tag}`, error)))),
    Effect.forever,
  );
  // Subscribed already; the caller runs this in the background.
  return Effect.andThen(reconcile.pipe(Effect.catch((error) => Effect.logError("inbox: can't reconcile pending requests", error))), consume);
});
