import type { Attachment } from "@wiki-agents/contracts/attachments/model";
import type { FileChange } from "@wiki-agents/contracts/changes/model";
import type { PlanStep, RequestAnswer, RequestPrompt, StoredThreadEvent, ThreadEvent, TurnOutcome, TurnUsage } from "@wiki-agents/contracts/threads/model";

/** What the conversation shows, built from the thread's events in order. */
export type TimelineItem =
  | { readonly kind: "notice"; readonly key: string; readonly text: string; readonly href?: string; readonly path?: string }
  /** `unattended`: sent by a schedule, with nobody watching. `imagesAsFiles`: its images went as files. */
  | {
      readonly kind: "user";
      readonly key: string;
      readonly text: string;
      readonly unattended: boolean;
      readonly attachments: ReadonlyArray<Attachment>;
      readonly imagesAsFiles: boolean;
    }
  /** You asked the provider to compact the conversation (Compact conversation). */
  | { readonly kind: "compaction-request"; readonly key: string }
  /** The receipt of a schedule the agent saved, with a link to edit it. */
  | { readonly kind: "schedule"; readonly key: string; readonly receipt: Extract<ThreadEvent, { readonly _tag: "schedule.saved" }> }
  /** A page the agent opened wants a sign-in the project doesn't have, with a link to add one. */
  | { readonly kind: "sign-in"; readonly key: string; readonly card: Extract<ThreadEvent, { readonly _tag: "browser.sign_in_needed" }> }
  | { readonly kind: "agent"; readonly key: string; text: string }
  | {
      readonly kind: "tool";
      readonly key: string;
      readonly name: string;
      readonly input: string;
      status: "running" | "succeeded" | "failed";
      output: string;
    }
  | {
      readonly kind: "request";
      readonly key: string;
      readonly requestId: string;
      readonly prompt: RequestPrompt;
      /** `pending` until answered; null when cancelled because the turn ended. */
      answer: RequestAnswer | null | "pending";
    }
  /**
   * The models a router (Copilot Auto) ran the turn on, in the order the provider
   * reported them; one per turn, updated in place. The thread keeps its choice.
   */
  | { readonly kind: "routing"; readonly key: string; readonly selected: string; models: Array<{ readonly id: string; readonly name: string }> }
  /** The agent's plan for a turn, as it last reported it; one per turn, updated in place. */
  | { readonly kind: "plan"; readonly key: string; readonly turnId: string; steps: ReadonlyArray<PlanStep> }
  | {
      /** What the turn changed in the vault's notes; `undone` follows `change.undone`. */
      readonly kind: "changes";
      readonly key: string;
      readonly turnId: string;
      readonly changes: Array<FileChange & { undone: boolean }>;
    }
  | {
      readonly kind: "turn-end";
      readonly key: string;
      readonly outcome: TurnOutcome;
      readonly usage: TurnUsage | null;
      readonly reason: string | null;
    };

export interface Timeline {
  readonly items: Array<TimelineItem>;
  /** The last event applied; older or repeated events are skipped. */
  lastSeq: number;
  /** The turn still running, if any. */
  runningTurn: string | null;
  /** Turns that are compactions you asked for, rather than messages. */
  readonly compactions: Set<string>;
}

export const emptyTimeline = (): Timeline => ({ items: [], lastSeq: 0, runningTurn: null, compactions: new Set() });

/** The running turn is a compaction you asked for. */
export const isCompacting = (timeline: Timeline) => timeline.runningTurn !== null && timeline.compactions.has(timeline.runningTurn);

/** A turn has finished, so there is a conversation to compact. */
export const hasConversation = (timeline: Timeline) => timeline.items.some((item) => item.kind === "turn-end");

const find = <K extends TimelineItem["kind"]>(timeline: Timeline, kind: K, key: string) =>
  timeline.items.findLast((item): item is Extract<TimelineItem, { kind: K }> => item.kind === kind && item.key === key);

/**
 * Applies one stored event, in place (so a Svelte `$state` timeline updates only
 * what changed). Returns false for an event already applied.
 */
export const applyEvent = (timeline: Timeline, stored: StoredThreadEvent): boolean => {
  if (stored.seq <= timeline.lastSeq) return false;
  timeline.lastSeq = stored.seq;
  const event = stored.event;
  switch (event._tag) {
    case "notice":
      timeline.items.push({ kind: "notice", key: String(stored.seq), text: event.text });
      break;
    case "note.opened":
      timeline.items.push({ kind: "notice", key: String(stored.seq), text: `Opened ${event.title}${event.heading ? ` · ${event.heading}` : ""}`, href: event.href });
      break;
    case "note.context":
      timeline.items.push({ kind: "notice", key: String(stored.seq), path: event.note.path, text: `${event.note.reason}: ${event.note.path} · sha256 ${event.note.hash.slice(0, 12)}${event.note.notices.length ? ` · ${event.note.notices.join(" ")}` : ""}` });
      break;
    case "user.message":
      timeline.items.push({
        kind: "user",
        key: event.turnId,
        text: event.text,
        unattended: event.unattended === true,
        attachments: event.attachments ?? [],
        imagesAsFiles: event.imagesAsFiles === true,
      });
      break;
    case "compaction.requested":
      timeline.compactions.add(event.turnId);
      timeline.items.push({ kind: "compaction-request", key: event.turnId });
      break;
    case "turn.started":
      timeline.runningTurn = event.turnId;
      break;
    case "message.delta": {
      const message = find(timeline, "agent", event.messageId);
      if (message) message.text += event.text;
      else timeline.items.push({ kind: "agent", key: event.messageId, text: event.text });
      break;
    }
    case "tool.called":
      timeline.items.push({ kind: "tool", key: event.callId, name: event.name, input: event.input, status: "running", output: "" });
      break;
    case "tool.finished": {
      const tool = find(timeline, "tool", event.callId);
      if (tool) {
        tool.status = event.status;
        tool.output = event.output;
      }
      break;
    }
    case "request.opened":
      timeline.items.push({ kind: "request", key: event.requestId, requestId: event.requestId, prompt: event.prompt, answer: "pending" });
      break;
    case "request.resolved": {
      const request = find(timeline, "request", event.requestId);
      if (request) request.answer = event.answer;
      break;
    }
    case "plan.updated": {
      const plan = find(timeline, "plan", `${event.turnId}:plan`);
      if (plan) plan.steps = event.steps;
      else timeline.items.push({ kind: "plan", key: `${event.turnId}:plan`, turnId: event.turnId, steps: event.steps });
      break;
    }
    case "model.routed": {
      const routing = find(timeline, "routing", `${event.turnId}:routing`);
      if (routing === undefined) {
        timeline.items.push({ kind: "routing", key: `${event.turnId}:routing`, selected: event.selected.name, models: [event.model] });
      } else if (!routing.models.some((model) => model.id === event.model.id)) {
        routing.models.push(event.model);
      }
      break;
    }
    case "schedule.saved":
      timeline.items.push({ kind: "schedule", key: String(stored.seq), receipt: event });
      break;
    case "browser.sign_in_needed":
      timeline.items.push({ kind: "sign-in", key: String(stored.seq), card: event });
      break;
    case "turn.changes":
      timeline.items.push({
        kind: "changes",
        key: `${event.turnId}:changes`,
        turnId: event.turnId,
        changes: event.changes.map((change) => ({ ...change, undone: false })),
      });
      break;
    case "change.undone": {
      const changes = find(timeline, "changes", `${event.turnId}:changes`);
      const change = changes?.changes.find((item) => item.id === event.changeId);
      if (change) change.undone = true;
      break;
    }
    case "context.compaction": {
      if (event.outcome === "noop") {
        timeline.items.push({ kind: "notice", key: String(stored.seq), text: "Compaction finished, but the provider didn't report compacting anything" });
        break;
      }
      const label = compactionLabel(event.trigger, event.summaryOnly === true);
      const tokens = event.beforeTokens === undefined
        ? ""
        : event.afterTokens === undefined
          ? ` · ${compact.format(event.beforeTokens)} tokens before`
          : ` · ${compact.format(event.beforeTokens)} → ${compact.format(event.afterTokens)} tokens`;
      const reason = event.reason === undefined ? "" : ` · ${event.reason}`;
      timeline.items.push({ kind: "notice", key: String(stored.seq), text: `${label} ${event.outcome}${tokens}${reason}` });
      break;
    }
    case "turn.finished":
      timeline.items.push({ kind: "turn-end", key: `${event.turnId}:end`, outcome: event.outcome, usage: event.usage, reason: event.reason });
      if (timeline.runningTurn === event.turnId) timeline.runningTurn = null;
      // Tools still running when the turn ended never finished.
      for (const item of timeline.items) if (item.kind === "tool" && item.status === "running") item.status = "failed";
      break;
  }
  return true;
};

/** Requests still waiting for an answer. */
export const pendingRequests = (timeline: Timeline) =>
  timeline.items.filter((item): item is Extract<TimelineItem, { kind: "request" }> => item.kind === "request" && item.answer === "pending");

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

/** Names a compaction: automatic ones say so, and a summary-only one is named as such. */
const compactionLabel = (trigger: "auto" | "manual" | "unknown", summaryOnly: boolean): string => {
  if (trigger === "auto") return summaryOnly ? "Automatic compaction summary" : "Automatic context compaction";
  if (trigger === "manual" && !summaryOnly) return "Requested compaction";
  return summaryOnly ? "Context compaction summary" : "Context compaction";
};

const contextLabel = (context: NonNullable<TurnUsage["context"]>): string => {
  switch (context._tag) {
    case "last_request":
      return `${compact.format(context.inputTokens)} last request input / ${compact.format(context.windowTokens)} window`;
    case "last_step":
      return `${compact.format(context.inputTokens)} last reported step input`;
    case "compaction_window_estimate":
      return `${compact.format(context.usedTokens)} estimated context / ${compact.format(context.windowTokens)} compaction window`;
  }
};

/** "Copilot Auto · Routed to GPT-6 Luna", or to several models in the order they were used. */
export const routingLabel = (item: Extract<TimelineItem, { kind: "routing" }>) =>
  `${item.selected} · Routed to ${item.models.map((model) => model.name).join(", ")}`;

/** "12.5K in · 187 out · $0.026" */
export const usageLabel = (usage: TurnUsage) =>
  [
    `${compact.format(usage.inputTokens)} in`,
    `${compact.format(usage.outputTokens)} out`,
    ...(usage.breakdown?.cacheReadTokens ? [`${compact.format(usage.breakdown.cacheReadTokens)} cache read`] : []),
    ...(usage.breakdown?.cacheWriteTokens ? [`${compact.format(usage.breakdown.cacheWriteTokens)} cache write`] : []),
    ...(usage.breakdown?.reasoningTokens ? [`${compact.format(usage.breakdown.reasoningTokens)} reasoning`] : []),
    ...(usage.context === undefined ? [] : [contextLabel(usage.context)]),
    ...(usage.costUsd === null ? [] : [`$${usage.costUsd.toFixed(usage.costUsd < 0.1 ? 3 : 2)}`]),
  ].join(" · ");
