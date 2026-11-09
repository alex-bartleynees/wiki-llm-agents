import type { ProviderCapabilities } from "@wiki-agents/contracts/providers/model";
import type { RequestAnswer, ThreadEvent } from "@wiki-agents/contracts/threads/model";
import { Data, type Effect, type Option, type Scope, type Stream } from "effect";

/**
 * What a provider reports during a turn: the thread events only an agent produces.
 * Every event carries the turn's id. A turn's stream ends after `turn.finished`; a
 * stream that ends without one is taken as a completed turn without usage.
 */
export type ProviderEvent = Extract<
  ThreadEvent,
  { readonly _tag: "message.delta" | "tool.called" | "tool.finished" | "request.opened" | "turn.finished" }
>;

export class ProviderError extends Data.TaggedError("ProviderError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface TurnInput {
  readonly turnId: string;
  readonly text: string;
}

export interface ResumeInput extends TurnInput {
  /** Requests of this turn still waiting for an answer. */
  readonly pendingRequestIds: ReadonlyArray<string>;
}

/** A provider conversation for one thread, owned by its ThreadActor's scope. */
export interface ProviderSession {
  /** Runs a turn. The stream is live: subscribe-before-send is the adapter's job. */
  readonly startTurn: (turn: TurnInput) => Stream.Stream<ProviderEvent, ProviderError>;
  /**
   * Continues a turn that was running when the server stopped, from where the
   * provider left it (pending requests stay answerable). None when it can't.
   */
  readonly resumeTurn: (turn: ResumeInput) => Effect.Effect<Option.Option<Stream.Stream<ProviderEvent, ProviderError>>>;
  /** Asks the provider to stop the turn; the actor stops reading its stream either way. */
  readonly interrupt: (turnId: string) => Effect.Effect<void>;
  readonly answerRequest: (requestId: string, answer: RequestAnswer) => Effect.Effect<void, ProviderError>;
}

export interface OpenSessionInput {
  readonly threadId: string;
  /** The agent's working directory. */
  readonly cwd: string;
  /** The provider's session id from an earlier run, to resume. */
  readonly nativeSessionId: string | null;
}

/**
 * One per provider kind. Nothing outside `providers/` checks which kind a thread
 * uses; the UI reads `capabilities` instead.
 */
export interface ProviderAdapter {
  readonly kind: string;
  readonly capabilities: ProviderCapabilities;
  /** Closing the scope ends the session and any process it started. */
  readonly openSession: (input: OpenSessionInput) => Effect.Effect<ProviderSession, ProviderError, Scope.Scope>;
}
