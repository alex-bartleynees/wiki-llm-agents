import type { OpenCodeEvent } from "@opencode/protocol/groups/event";
import { Data, type Effect, type PubSub, type Scope } from "effect";

export type { OpenCodeEvent };

export class OpenCodeError extends Data.TaggedError("OpenCodeError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * What the server's event stream delivers: OpenCode's events, and a note each time
 * the stream reconnects. Events sent while it was down are lost, so a reconnect
 * means "check what you missed".
 */
export type OpenCodeSignal =
  | { readonly _tag: "event"; readonly event: OpenCodeEvent }
  | { readonly _tag: "reconnected" }
  /** The OpenCode process exited without being asked to (it crashed, or was killed). */
  | { readonly _tag: "stopped" };

/** A model OpenCode offers, as `<providerID>/<modelID>`. */
export interface OpenCodeModel {
  readonly id: string;
  readonly name: string;
  /** Free to use (OpenCode Zen's free models, local models). */
  readonly free: boolean;
}

/** How a session's last turn ended, from its newest `idle` message. */
export type OpenCodeOutcome = "succeeded" | "failed" | "interrupted";

/** A rule OpenCode applies to the session's tool calls (`edit`, `bash`...). */
export interface OpenCodePermissionRule {
  readonly action: string;
  readonly resource: string;
  readonly effect: "allow" | "ask" | "deny";
}

/**
 * The OpenCode 2 operations the adapter uses, over one running `opencode serve`.
 * The live one wraps `@opencode/client/effect`; tests use one that plays recorded
 * event streams (`tests/fixtures/opencode`).
 */
export interface OpenCodeApi {
  readonly version: string;
  /** True once the server has stopped on its own; every call then fails. */
  readonly isStopped: Effect.Effect<boolean>;
  /**
   * Every session's events. Subscribe before prompting: the stream is live only,
   * and a subscription sees only what is published after it is taken.
   */
  readonly subscribe: Effect.Effect<PubSub.Subscription<OpenCodeSignal>, never, Scope.Scope>;
  readonly createSession: (input: {
    readonly directory: string;
    readonly model: string | null;
    readonly permissions: ReadonlyArray<OpenCodePermissionRule>;
  }) => Effect.Effect<string, OpenCodeError>;
  /** Replaces the session's permission rules (it keeps the ones it was created with otherwise). */
  readonly setPermissions: (sessionId: string, permissions: ReadonlyArray<OpenCodePermissionRule>) => Effect.Effect<void, OpenCodeError>;
  /**
   * Sets the app's instructions on the session (OpenCode adds them to the system
   * prompt as `<context key="wiki-agents">`), or removes them with null. Setting the
   * same text again changes nothing.
   */
  readonly setInstructions: (sessionId: string, text: string | null) => Effect.Effect<void, OpenCodeError>;
  /** False when OpenCode no longer has the session (deleted, or another data directory). */
  readonly sessionExists: (sessionId: string) => Effect.Effect<boolean, OpenCodeError>;
  /** Queues a message; OpenCode starts running it unless a turn is already running. Returns its inbox id. */
  readonly prompt: (sessionId: string, text: string) => Effect.Effect<string, OpenCodeError>;
  /** Withdraws a queued message that hasn't been delivered to the agent yet. */
  readonly cancelPrompt: (sessionId: string, inboxId: string) => Effect.Effect<void, OpenCodeError>;
  /** True when a running turn was stopped; false when nothing was running. */
  readonly interrupt: (sessionId: string) => Effect.Effect<boolean, OpenCodeError>;
  readonly isRunning: (sessionId: string) => Effect.Effect<boolean, OpenCodeError>;
  readonly lastOutcome: (sessionId: string) => Effect.Effect<OpenCodeOutcome | null, OpenCodeError>;
  /**
   * Answers an approval. A rejection without a message ends the whole turn; with one,
   * the agent is told why and carries on.
   */
  readonly replyPermission: (
    sessionId: string,
    requestId: string,
    reply: "once" | "reject",
    message?: string,
  ) => Effect.Effect<void, OpenCodeError>;
  readonly replyForm: (sessionId: string, formId: string, answer: Readonly<Record<string, string>>) => Effect.Effect<void, OpenCodeError>;
  readonly listModels: (directory: string) => Effect.Effect<ReadonlyArray<OpenCodeModel>, OpenCodeError>;
  readonly defaultModel: (directory: string) => Effect.Effect<string | null, OpenCodeError>;
  readonly switchModel: (sessionId: string, model: string) => Effect.Effect<void, OpenCodeError>;
}

/** `<providerID>/<modelID>`, the app's name for an OpenCode model. */
export const modelName = (model: { readonly providerID: string; readonly id: string }) => `${model.providerID}/${model.id}`;

export const modelRef = (name: string) => {
  const slash = name.indexOf("/");
  return slash < 0 ? null : { providerID: name.slice(0, slash), id: name.slice(slash + 1) };
};
