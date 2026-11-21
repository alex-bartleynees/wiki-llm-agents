import { Attachment } from "../attachments/model.js";
import { FileChange, ProposedEdit } from "../changes/model.js";
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
  context: Schema.optionalKey(Schema.Union([
    Schema.TaggedStruct("last_request", { inputTokens: Schema.Number, windowTokens: Schema.Number }),
    Schema.TaggedStruct("last_step", { inputTokens: Schema.Number }),
    Schema.TaggedStruct("compaction_window_estimate", { usedTokens: Schema.Number, windowTokens: Schema.Number }),
  ])),
  /** Reported categories are already included in inputTokens or outputTokens. */
  breakdown: Schema.optionalKey(Schema.Struct({
    scope: Schema.Literals(["main_loop", "reported_steps", "reported_requests"]),
    uncachedInputTokens: Schema.optionalKey(Schema.Number),
    cacheReadTokens: Schema.optionalKey(Schema.Number),
    cacheWriteTokens: Schema.optionalKey(Schema.Number),
    reasoningTokens: Schema.optionalKey(Schema.Number),
  })),
});
export type TurnUsage = typeof TurnUsage.Type;

/** You sent a message; it starts a turn. */
export const UserMessage = Schema.TaggedStruct("user.message", {
  turnId: Schema.String,
  text: Schema.String,
  /** Child turns delivered by this automatic message. */
  childReports: Schema.optionalKey(Schema.Array(Schema.String)),
  /**
   * Sent by a schedule, with nobody watching: anything that would ask you (an
   * approval or a question) is denied instead of waiting.
   */
  unattended: Schema.optionalKey(Schema.Boolean),
  /** Files sent with the message (images and other files), in the order they were attached. */
  attachments: Schema.optionalKey(Schema.Array(Attachment)),
  /** The images went to the agent as files (listed by path), not as images. */
  imagesAsFiles: Schema.optionalKey(Schema.Boolean),
});

/**
 * You asked the provider to compact the conversation (Compact conversation). It
 * starts a turn instead of a message: the provider summarises the conversation in
 * its own session, and the turn ends when it says how that went.
 */
export const CompactionRequested = Schema.TaggedStruct("compaction.requested", {
  turnId: Schema.String,
});

/**
 * You asked the agent to write a handoff, so the work can carry on in a new thread
 * with a fresh provider session. It starts a turn instead of a message: the app asks
 * the agent, in this thread's session, for a summary under fixed headings, and the
 * agent's reply is the handoff you review before continuing.
 */
export const HandoffRequested = Schema.TaggedStruct("handoff.requested", {
  turnId: Schema.String,
});

export const TurnStarted = Schema.TaggedStruct("turn.started", {
  turnId: Schema.String,
});

/**
 * Where a subagent is: `running`; `waiting` for your answer to its request; `done`
 * (it went idle and reported, and may be given more work); `failed`; `cancelled`
 * (stopped, by Stop or by its agent); `interrupted` (the server or the provider
 * stopped under it, so whatever it was doing is unknown).
 */
export const SubagentStatus = Schema.Literals(["running", "waiting", "done", "failed", "cancelled", "interrupted"]);
export type SubagentStatus = typeof SubagentStatus.Type;

/** A subagent still at work: running, or waiting for you. */
export const isSubagentActive = (status: SubagentStatus) => status === "running" || status === "waiting";

/**
 * A subagent (a child the agent delegated to, with the provider's own delegation)
 * as it is now: the whole state each time it changes, so the latest wins.
 * `turnId` is the turn that launched it, where the conversation shows it.
 */
export const SubagentUpdated = Schema.TaggedStruct("subagent.updated", {
  turnId: Schema.String,
  /** The provider's id for the child (an OpenCode session id). */
  subagentId: Schema.String,
  /** What the agent called the work, e.g. "Read first line of Tea.md". */
  label: Schema.String,
  /** The provider's agent it runs as, e.g. `explore`; null when it doesn't say. */
  agent: Schema.NullOr(Schema.String),
  status: SubagentStatus,
  /** Its latest report, as the parent agent was given it; null before any. */
  result: Schema.NullOr(Schema.String),
});

/** A subagent's report that started a turn. */
export const SubagentReport = Schema.Struct({
  subagentId: Schema.String,
  label: Schema.String,
  status: SubagentStatus,
});
export type SubagentReport = typeof SubagentReport.Type;

/**
 * Subagents reported to the agent, and the provider started a turn on it by itself:
 * like a message, it starts a turn, but nobody sent one. Shown as a "Subagent
 * reported" divider.
 */
export const SubagentReported = Schema.TaggedStruct("subagent.reported", {
  turnId: Schema.String,
  reports: Schema.Array(SubagentReport),
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
  /** Absolute paths of files the tool writes, when the provider says; used to attribute vault changes. */
  writes: Schema.optionalKey(Schema.Array(Schema.String)),
});

export const ToolFinished = Schema.TaggedStruct("tool.finished", {
  turnId: Schema.String,
  callId: Schema.String,
  status: Schema.Literals(["succeeded", "failed"]),
  output: Schema.String,
  /** Absolute paths of files the tool wrote, when the provider says. */
  writes: Schema.optionalKey(Schema.Array(Schema.String)),
});

/** Approve or deny something the agent wants to do. */
export const ApprovalPrompt = Schema.TaggedStruct("approval", {
  /** What the agent wants to do, e.g. "Edit Projects/Plan.md". */
  title: Schema.String,
  /** Details such as the command or the change; plain text. */
  detail: Schema.String,
  /** For a file edit: each file's diff and edit warnings, shown instead of `detail`. */
  edits: Schema.optionalKey(Schema.Array(ProposedEdit)),
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
  /**
   * A subagent asked, not the agent itself (`turnId` is the turn that launched it).
   * Its request stays open after that turn ends, until it is answered or the
   * subagent stops.
   */
  subagentId: Schema.optionalKey(Schema.String),
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

/**
 * The agent reached a page that wants a sign-in the project doesn't have
 * (`browser_sign_in_needed`): a card with a link to add one. You add it in the
 * project, never in the conversation; the browser has it from the next turn.
 */
export const SignInNeeded = Schema.TaggedStruct("browser.sign_in_needed", {
  turnId: Schema.String,
  projectId: Schema.String,
  /** What the agent calls the site, e.g. "My app (local)". */
  site: Schema.String,
  /** The page's origin, e.g. `http://localhost:3000`. */
  origin: Schema.String,
  /** Why it needs one, in the agent's words; null when it gave none. */
  reason: Schema.NullOr(Schema.String),
  /** Where you add it: the project's browser sign-ins. */
  href: Schema.String,
});

/**
 * What the turn changed in the vault's notes, recorded as it finishes (only when it
 * changed something), before `turn.finished`.
 */
export const TurnChanges = Schema.TaggedStruct("turn.changes", {
  turnId: Schema.String,
  changes: Schema.Array(FileChange),
});

/** A change was undone (`turnId` is the turn that made it). */
export const ChangeUndone = Schema.TaggedStruct("change.undone", {
  turnId: Schema.String,
  changeId: Schema.String,
});

/**
 * The agent created or changed a schedule with the schedule tools: the receipt shown
 * in the conversation, with a link to edit it.
 */
export const ScheduleSaved = Schema.TaggedStruct("schedule.saved", {
  turnId: Schema.String,
  action: Schema.Literals(["created", "updated", "paused", "resumed", "deleted", "run"]),
  scheduleId: Schema.String,
  kind: Schema.Literals(["reminder", "prompt"]),
  title: Schema.String,
  /** The reminder's message, or the prompt. */
  text: Schema.String,
  recurrence: Schema.String,
  /** The next time as a local date, time and timezone; null when it won't fire again. */
  next: Schema.NullOr(Schema.String),
  timezone: Schema.String,
  /** A scheduled prompt's agent (its name), or null. */
  agent: Schema.NullOr(Schema.String),
  /** Where it arrives, e.g. "Inbox". */
  destination: Schema.String,
  /** Where to edit it in the app. */
  href: Schema.String,
});

/** One step of the agent's plan for the turn. */
export const PlanStep = Schema.Struct({
  text: Schema.String,
  status: Schema.Literals(["pending", "in_progress", "completed", "cancelled"]),
});
export type PlanStep = typeof PlanStep.Type;

/** Steps done (completed or cancelled), in all, and the one in progress. */
export const planProgress = (steps: ReadonlyArray<PlanStep>) => ({
  done: steps.filter((step) => step.status === "completed" || step.status === "cancelled").length,
  total: steps.length,
  current: steps.find((step) => step.status === "in_progress")?.text ?? null,
});

/**
 * The agent's plan for the turn, whole, each time it changes: Claude Code's and
 * OpenCode's todo lists, Codex's plan updates. Providers without one never send it.
 */
export const PlanUpdated = Schema.TaggedStruct("plan.updated", {
  turnId: Schema.String,
  steps: Schema.Array(PlanStep),
});

/**
 * A native compaction outcome observed while the provider was streaming a turn.
 * `noop`: a compaction you asked for finished without the provider reporting that
 * it compacted anything (nothing to compact, or it doesn't say).
 */
export const ContextCompaction = Schema.TaggedStruct("context.compaction", {
  turnId: Schema.String,
  outcome: Schema.Literals(["completed", "failed", "noop"]),
  trigger: Schema.Literals(["auto", "manual", "unknown"]),
  summaryOnly: Schema.optionalKey(Schema.Boolean),
  beforeTokens: Schema.optionalKey(Schema.Number),
  afterTokens: Schema.optionalKey(Schema.Number),
  /** Why it failed, when the provider says. */
  reason: Schema.optionalKey(Schema.String),
});

/** A model as a turn names it: the provider's id and a name to show. */
export const NamedModel = Schema.Struct({
  /** The provider's name for it, e.g. `github-copilot/gpt-6-luna`. */
  id: Schema.String,
  /** Its name in the provider's model list, or the id when it isn't listed. */
  name: Schema.String,
});
export type NamedModel = typeof NamedModel.Type;

/**
 * The provider ran the turn on a model other than the one chosen, as a router
 * such as Copilot Auto does. Sent once per model, when the provider first reports
 * it; a turn routed to several models has one for each. The thread keeps its choice.
 */
export const ModelRouted = Schema.TaggedStruct("model.routed", {
  turnId: Schema.String,
  /** The model the thread asked for, e.g. Copilot Auto. */
  selected: NamedModel,
  /** The model the provider says it used. */
  model: NamedModel,
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
  CompactionRequested,
  HandoffRequested,
  SubagentReported,
  NoteContext,
  TurnStarted,
  SubagentUpdated,
  MessageDelta,
  ToolCalled,
  ToolFinished,
  RequestOpened,
  RequestResolved,
  NoteOpened,
  SignInNeeded,
  TurnNotice,
  TurnChanges,
  ChangeUndone,
  ScheduleSaved,
  PlanUpdated,
  ContextCompaction,
  ModelRouted,
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

/** The running turn: when it started, and how far through its plan the agent is. */
export const RunningTurn = Schema.Struct({
  startedAt: Schema.Number,
  /** Steps done (completed or cancelled) and in all; null until the agent reports a plan. */
  progress: Schema.NullOr(
    Schema.Struct({
      done: Schema.Number,
      total: Schema.Number,
      /** The step in progress, if any. */
      current: Schema.NullOr(Schema.String),
    }),
  ),
});
export type RunningTurn = typeof RunningTurn.Type;

/** How the thread's latest finished turn ended. */
export const LastTurn = Schema.Struct({
  outcome: TurnOutcome,
  /** Why it failed or stopped, when it wasn't you pressing Stop. */
  reason: Schema.NullOr(Schema.String),
  endedAt: Schema.Number,
});
export type LastTurn = typeof LastTurn.Type;

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
  /** The turn running or waiting for you; null when idle. */
  runningTurn: Schema.NullOr(RunningTurn),
  /** The latest finished turn; null before any. */
  lastTurn: Schema.NullOr(LastTurn),
  /** When you marked the thread done; null while it is open. A new message reopens it. */
  doneAt: Schema.NullOr(Schema.Number),
  doneReason: Schema.optional(Schema.NullOr(Schema.Literal("inactivity"))),
  /** The thread this one continues (Continue in a new thread); null when it continues none. */
  continuedFrom: Schema.NullOr(Schema.String),
  /** The manager that launched this child app thread. */
  parentThreadId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** The newest thread that continues this one; null when none does. */
  continuedIn: Schema.NullOr(Schema.String),
  /**
   * Subagents still at work (running, or waiting for you). They can run while the
   * agent itself is idle; Stop stops them with the turn.
   */
  subagentsActive: Schema.Number,
  /** The last event's seq; 0 for a new thread. */
  lastSeq: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type ThreadSummary = typeof ThreadSummary.Type;

/**
 * Where a thread shows in the running view: `waiting` for you, `working`, or
 * `stopped` (its last turn failed, or stopped without you pressing Stop: the server
 * restarted, the provider gave up). Null for threads that need nothing.
 */
export type ThreadActivity = "waiting" | "working" | "stopped";

/** How long a stopped thread stays in the running view, unless you carry on or mark it done. */
export const STOPPED_SHOWN_FOR = 7 * 24 * 60 * 60 * 1000;

export const threadActivity = (thread: ThreadSummary, now: number): ThreadActivity | null => {
  if (thread.status === "waiting") return "waiting";
  if (thread.status === "running" || thread.subagentsActive > 0) return "working";
  const last = thread.lastTurn;
  if (thread.doneAt !== null || last === null) return null;
  const stopped = last.outcome === "failed" || (last.outcome === "interrupted" && last.reason !== null);
  return stopped && now - last.endedAt < STOPPED_SHOWN_FOR ? "stopped" : null;
};

/** The running view's page in the web app. */
export const RUNNING_PATH = "/inbox/running";
