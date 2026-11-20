import { randomUUID } from "node:crypto";
import type { Autonomy } from "@wiki-agents/contracts/agents/model";
import type { TurnUsage } from "@wiki-agents/contracts/threads/model";
import { Duration, Effect, Stream } from "effect";
import { NO_PROTECTION } from "../../shared/secret-paths.js";
import { type Completion, type CompletionInput, type ProviderAdapter, ProviderError, type SessionSetup } from "./port.js";

/** A one-shot answer that takes longer than this has gone wrong. */
export const COMPLETION_TIMEOUT = Duration.minutes(2);

/** Nothing the model asks to do is allowed: a one-shot call only answers. */
const NOTHING: Autonomy = { read: "deny", create: "deny", edit: "deny", commands: "deny", web: "deny", tools: "deny", subagents: "deny" };

/**
 * One turn in a throwaway session, for a provider without its own `complete`: every
 * action denied, no vault tools, no project folders; the session closes with the
 * scope. The answer is the turn's last message.
 */
const throughSession = (adapter: ProviderAdapter, input: CompletionInput) =>
  Effect.scoped(
    Effect.gen(function* () {
      const setup: SessionSetup = {
        instructions: [{ source: "rules", title: "One-shot request", path: input.cwd, text: input.system }],
        autonomy: NOTHING,
        projectRoots: [input.cwd],
        attachmentFolders: [],
        protection: NO_PROTECTION,
        vaultTools: null,
      };
      const session = yield* adapter.openSession({ threadId: `one-shot-${randomUUID()}`, cwd: input.cwd, nativeSessionId: null, model: input.model, setup });
      const turnId = randomUUID();
      const messages = new Map<string, string>();
      let usage: TurnUsage | null = null;
      let failure: string | null = null;
      yield* session.startTurn({ turnId, text: input.prompt, images: [], setup }).pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            switch (event._tag) {
              case "message.delta": {
                // Deleted and set again, so the message that last got text comes last.
                const text = `${messages.get(event.messageId) ?? ""}${event.text}`;
                messages.delete(event.messageId);
                messages.set(event.messageId, text);
                break;
              }
              case "request.opened":
                failure ??= "The model asked for something instead of answering.";
                break;
              case "turn.finished":
                usage = event.usage;
                if (event.outcome !== "completed") failure ??= event.reason ?? `The model's turn ${event.outcome === "failed" ? "failed" : "stopped"}.`;
                break;
            }
          }),
        ),
      );
      if (failure !== null) return yield* new ProviderError({ message: failure });
      return { text: [...messages.values()].at(-1) ?? "", usage } satisfies Completion;
    }),
  );

/**
 * One prompt, one answer, through the provider's own one-shot call when it has one,
 * else one turn of a throwaway session. Fails when nothing came back or it takes
 * longer than `COMPLETION_TIMEOUT`.
 */
export const complete = (adapter: ProviderAdapter, input: CompletionInput) =>
  (adapter.complete === undefined ? throughSession(adapter, input) : adapter.complete(input)).pipe(
    Effect.timeoutOrElse({
      duration: COMPLETION_TIMEOUT,
      orElse: () => Effect.fail(new ProviderError({ message: `No answer within ${Duration.format(COMPLETION_TIMEOUT)}.` })),
    }),
    Effect.flatMap((completion) =>
      completion.text.trim() === "" ? Effect.fail(new ProviderError({ message: "The model gave an empty answer." })) : Effect.succeed(completion),
    ),
  );
