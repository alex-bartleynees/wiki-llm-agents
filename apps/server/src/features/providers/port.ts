import type { Autonomy } from "@wiki-agents/contracts/agents/model";
import type { ProviderCapabilities, ProviderModel, ProviderStatus } from "@wiki-agents/contracts/providers/model";
import type { RequestAnswer, ThreadEvent, TurnUsage } from "@wiki-agents/contracts/threads/model";
import { Data, type Effect, type Option, type Scope, type Stream } from "effect";
import type { Protection } from "../../shared/secret-paths.js";
import type { VaultToolsEntry } from "../mcp/vault-tools.js";

/**
 * What a provider reports during a turn: the thread events only an agent produces.
 * Every event carries the turn's id. A turn's stream ends after `turn.finished`; a
 * stream that ends without one is taken as a completed turn without usage.
 */
export type ProviderEvent = Extract<
  ThreadEvent,
  { readonly _tag: "message.delta" | "tool.called" | "tool.finished" | "request.opened" | "notice" | "plan.updated" | "context.compaction" | "model.routed" | "turn.finished" }
>;

export class ProviderError extends Data.TaggedError("ProviderError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Text the agent is told on top of the provider's own instructions. */
export interface Instruction {
  /** `rules`: applies to every agent; `agent`: the named agent's file; `vault`: the vault's own `AGENTS.md`; `project`: the thread's project. */
  readonly source: "rules" | "agent" | "vault" | "project";
  /** Where it comes from, e.g. `rules/wiki-llm.md`, `Researcher agent`, `AGENTS.md in the vault`. */
  readonly title: string;
  /** Absolute path of the file it was read from. */
  readonly path: string;
  readonly text: string;
}

/** The thread's agent: instructions, in order (later ones win where they disagree), and the autonomy the provider enforces. */
export interface AgentSetup {
  readonly instructions: ReadonlyArray<Instruction>;
  readonly autonomy: Autonomy;
}

/**
 * What the app layers on a session: the agent's setup and the vault tools. Sent
 * with every turn, so edits to the rules, the agent's file, a different agent, or a
 * new token apply from the next turn; adapters skip what hasn't changed.
 */
export interface SessionSetup extends AgentSetup {
  /**
   * For a project thread, the canonical folders it may reach without asking (its
   * working directories and the shared vault); anywhere else needs the user's
   * approval. Null for a vault thread, which the provider's own working-folder rules cover.
   */
  readonly projectRoots: ReadonlyArray<string> | null;
  /**
   * Canonical folders holding the attachments sent in this thread (one per file, in
   * the app's attachments folder). The agent may read them without asking; writing
   * there still asks, and another thread's attachments ask like anything outside.
   */
  readonly attachmentFolders: ReadonlyArray<string>;
  /**
   * What no tool may read or write, whatever the autonomy: the files and folders that
   * hold secrets and the extra protected paths and name patterns (see
   * `SecretMaterial`). Adapters deny them with every means the provider has: its
   * sandbox, its permission rules, or the app's own check.
   */
  readonly protection: Protection;
  /**
   * The vault MCP server for this thread, which the provider registers for the
   * session; null when there is none (the replay provider ignores it). A provider
   * that can't register it still runs the turn, without the tools.
   */
  readonly vaultTools: VaultToolsEntry | null;
}

/** An image from the message, for a provider with `capabilities.images`. */
export interface TurnImage {
  /** Absolute path of the file, in the app's attachments folder. */
  readonly path: string;
  readonly name: string;
  /** `image/png`, `image/jpeg`, `image/gif` or `image/webp`. */
  readonly mime: string;
  readonly size: number;
}

export interface TurnInput {
  readonly turnId: string;
  /** The message, with its notes and a list of its attached files (and images, for a provider without `images`). */
  readonly text: string;
  /** The message's images, to send as images; always empty for a provider without `capabilities.images`. */
  readonly images: ReadonlyArray<TurnImage>;
  readonly setup: SessionSetup;
}

/** A compaction you asked for, run as a turn of its own. */
export interface CompactInput {
  readonly turnId: string;
  readonly setup: SessionSetup;
}

export interface ResumeInput extends TurnInput {
  /** Requests of this turn still waiting for an answer. */
  readonly pendingRequestIds: ReadonlyArray<string>;
}

/** A provider conversation for one thread, owned by its ThreadActor's scope. */
export interface ProviderSession {
  /** The provider's id for the conversation, saved on the thread so a later run continues it. */
  readonly nativeSessionId: string | null;
  /** Runs a turn. The stream is live: subscribe-before-send is the adapter's job. */
  readonly startTurn: (turn: TurnInput) => Stream.Stream<ProviderEvent, ProviderError>;
  /**
   * Continues a turn that was running when the server stopped, from where the
   * provider left it (pending requests stay answerable). None when it can't.
   */
  readonly resumeTurn: (turn: ResumeInput) => Effect.Effect<Option.Option<Stream.Stream<ProviderEvent, ProviderError>>>;
  /**
   * Compacts the conversation with the provider's own compaction, as a turn of its
   * own: `context.compaction` once the provider reports how it went (a manual
   * trigger), then `turn.finished` with what it cost. Accepting the request isn't
   * reported as compacting: only the provider's own evidence is. Stop interrupts it
   * like a turn. Present only when the adapter's `capabilities.compact` is true.
   */
  readonly compact?: (input: CompactInput) => Stream.Stream<ProviderEvent, ProviderError>;
  /** Asks the provider to stop the turn; the actor stops reading its stream either way. */
  readonly interrupt: (turnId: string) => Effect.Effect<void>;
  readonly answerRequest: (requestId: string, answer: RequestAnswer) => Effect.Effect<void, ProviderError>;
  /** Uses `model` from the next turn on. */
  readonly setModel: (model: string) => Effect.Effect<void, ProviderError>;
}

export interface OpenSessionInput {
  readonly threadId: string;
  /** The agent's working directory. */
  readonly cwd: string;
  /** The provider's session id from an earlier run, to continue that conversation. */
  readonly nativeSessionId: string | null;
  /** The thread's model; null for the provider's default. */
  readonly model: string | null;
  /** The setup a new session starts with (turns bring the current one). */
  readonly setup: SessionSetup;
}

/** One prompt, one answer: no tools, no vault tools, no conversation kept (commit messages...). */
export interface CompletionInput {
  /** Where the provider runs; nothing there is read on purpose. */
  readonly cwd: string;
  /** Null for the provider's default. */
  readonly model: string | null;
  /** What the model is for and how to answer. */
  readonly system: string;
  readonly prompt: string;
}

export interface Completion {
  readonly text: string;
  /** Null when the provider reports none. */
  readonly usage: TurnUsage | null;
}

export interface ModelList {
  readonly models: ReadonlyArray<ProviderModel>;
  /** The provider's default in that directory, if it has one. */
  readonly defaultModel: string | null;
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
  /** What this provider actually enforces for `autonomy`, and notes where that differs. */
  readonly enforcement: (autonomy: Autonomy) => { readonly autonomy: Autonomy | null; readonly notes: ReadonlyArray<string> };
  /** Whether turns can run: installed, a supported version, and it starts. Opens no session. */
  readonly status: Effect.Effect<ProviderStatus>;
  /** Models offered in `cwd`; none when `capabilities.models` is false. */
  readonly listModels: (cwd: string) => Effect.Effect<ModelList, ProviderError>;
  /**
   * A one-shot call without tools or a saved conversation, where the provider has a
   * lean way to make one. Without it, `complete` (in `complete.ts`) runs one turn in a
   * throwaway session that may do nothing.
   */
  readonly complete?: (input: CompletionInput) => Effect.Effect<Completion, ProviderError>;
}

/** Told to the user (not the agent) when the vault tools couldn't be given to a turn. */
export const vaultToolsUnavailable = (reason: string) => `The vault tools aren't available to the agent this turn: ${reason}`;

/** Sent with a denial, so the agent carries on instead of the turn ending. */
export const DENIED = "The user denied this. Don't try it another way; say what you would have done.";

/** Sent when a tool call reaches a protected file (see `SessionSetup.protection`). */
export const SECRET_DENIED = "This reaches a protected file (secrets, or a file such as .env), which agents may never read or change. Don't try it another way.";
