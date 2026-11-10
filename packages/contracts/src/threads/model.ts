import { NoteContext } from "./context.js";
import { Schema } from "effect";

/**
 * Normalised events in a thread, the same for every provider. They are stored in
 * order with a per-thread `seq`, streamed to the browser, and replayed on reconnect;
 * the browser builds the conversation from them.
 */

/** Token counts and cost for one turn, when the provider reports them. */
export const TurnUsage = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  /** Null when the provider doesn't report a cost (subscriptions). */
  costUsd: Schema.NullOr(Schema.Number),
});
export type TurnUsage = typeof TurnUsage.Type;

/** You sent a message; it starts a turn. */
export const UserMessage = Schema.TaggedStruct("user.message", {
  turnId: Schema.String,
  text: Schema.String,
});

export const TurnStarted = Schema.TaggedStruct("turn.started", {
  turnId: Schema.String,
});

/** More text of the agent's reply. Deltas with the same `messageId` are one message. */
export const MessageDelta = Schema.TaggedStruct("message.delta", {
  turnId: Schema.String,
  messageId: Schema.String,
  text: Schema.String,
});

/** The agent called a tool. `input` is a short, human-readable summary. */
export const ToolCalled = Schema.TaggedStruct("tool.called", {
  turnId: Schema.String,
  callId: Schema.String,
  name: Schema.String,
  input: Schema.String,
});

export const ToolFinished = Schema.TaggedStruct("tool.finished", {
  turnId: Schema.String,
  callId: Schema.String,
  status: Schema.Literals(["succeeded", "failed"]),
  output: Schema.String,
});

/** Approve or deny something the agent wants to do. */
export const ApprovalPrompt = Schema.TaggedStruct("approval", {
  /** What the agent wants to do, e.g. "Edit Projects/Plan.md". */
  title: Schema.String,
  /** Details such as the command or the change; plain text. */
  detail: Schema.String,
});

/** A question for you, with suggested answers; any text is accepted. */
export const QuestionPrompt = Schema.TaggedStruct("question", {
  question: Schema.String,
  options: Schema.Array(Schema.String),
});

export const RequestPrompt = Schema.Union([ApprovalPrompt, QuestionPrompt]);
export type RequestPrompt = typeof RequestPrompt.Type;

export const ApprovalAnswer = Schema.TaggedStruct("approval", {
  decision: Schema.Literals(["approve", "deny"]),
});
export const QuestionAnswer = Schema.TaggedStruct("question", {
  text: Schema.String.check(Schema.isNonEmpty()),
});

/** Your answer to a request; its kind must match the request's. */
export const RequestAnswer = Schema.Union([ApprovalAnswer, QuestionAnswer]);
export type RequestAnswer = typeof RequestAnswer.Type;

/** The agent is waiting for you. Stays answerable across server restarts. */
export const RequestOpened = Schema.TaggedStruct("request.opened", {
  turnId: Schema.String,
  requestId: Schema.String,
  prompt: RequestPrompt,
});

/** A request was answered, or cancelled (`answer` null) because its turn ended. */
export const RequestResolved = Schema.TaggedStruct("request.resolved", {
  turnId: Schema.String,
  requestId: Schema.String,
  answer: Schema.NullOr(RequestAnswer),
});

/**
 * Something you should know about the turn that isn't the agent's reply, e.g. the
 * vault tools couldn't be given to the agent. Never silently dropped.
 */
export const TurnNotice = Schema.TaggedStruct("notice", {
  turnId: Schema.String,
  text: Schema.String,
});

/**
 * The agent opened a note for you (`vault_open_note`), at a heading if it gave one.
 * Shown in the conversation; a browser watching live also opens it.
 */
export const NoteOpened = Schema.TaggedStruct("note.opened", {
  turnId: Schema.String,
  path: Schema.String,
  title: Schema.String,
  heading: Schema.NullOr(Schema.String),
  /** Where the app shows it, at the heading. */
  href: Schema.String,
});

export const TurnOutcome = Schema.Literals(["completed", "interrupted", "failed"]);
export type TurnOutcome = typeof TurnOutcome.Type;

export const TurnFinished = Schema.TaggedStruct("turn.finished", {
  turnId: Schema.String,
  outcome: TurnOutcome,
  usage: Schema.NullOr(TurnUsage),
  /** Why the turn failed or stopped, when it wasn't you pressing Stop. */
  reason: Schema.NullOr(Schema.String),
});

export const ThreadEvent = Schema.Union([
  UserMessage,
  NoteContext,
  TurnStarted,
  MessageDelta,
  ToolCalled,
  ToolFinished,
  RequestOpened,
  RequestResolved,
  NoteOpened,
  TurnNotice,
  TurnFinished,
]);
export type ThreadEvent = typeof ThreadEvent.Type;

/** A thread event as stored: `seq` counts up from 1 in each thread. */
export const StoredThreadEvent = Schema.Struct({
  threadId: Schema.String,
  seq: Schema.Number,
  /** Milliseconds since the epoch. */
  at: Schema.Number,
  event: ThreadEvent,
});
export type StoredThreadEvent = typeof StoredThreadEvent.Type;

/**
 * - `idle`: no turn running; you can send a message
 * - `running`: a turn is running
 * - `waiting`: a turn is waiting for you to answer a request
 */
export const ThreadStatus = Schema.Literals(["idle", "running", "waiting"]);
export type ThreadStatus = typeof ThreadStatus.Type;

export const ThreadSummary = Schema.Struct({
  id: Schema.String,
  vaultId: Schema.String,
  /** The project the thread belongs to; null for a vault thread. */
  projectId: Schema.NullOr(Schema.String),
  /** From the first message until renaming exists; null before any message. */
  title: Schema.NullOr(Schema.String),
  providerInstanceId: Schema.String,
  /** The model chosen for this thread; null uses the provider's default. */
  model: Schema.NullOr(Schema.String),
  /** The named agent whose instructions and autonomy the thread uses; null for none. */
  agentId: Schema.NullOr(Schema.String),
  status: ThreadStatus,
  /** The last event's seq; 0 for a new thread. */
  lastSeq: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type ThreadSummary = typeof ThreadSummary.Type;
