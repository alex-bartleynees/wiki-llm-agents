import type { FileChange } from "@wiki-agents/contracts/changes/model";
import type { PlanStep, RequestAnswer, RequestPrompt, StoredThreadEvent, ThreadEvent, TurnOutcome, TurnUsage } from "@wiki-agents/contracts/threads/model";

/** What the conversation shows, built from the thread's events in order. */
export type TimelineItem =
  | { readonly kind: "notice"; readonly key: string; readonly text: string; readonly href?: string; readonly path?: string }
  /** `unattended`: sent by a schedule, with nobody watching. */
  | { readonly kind: "user"; readonly key: string; readonly text: string; readonly unattended: boolean }
  /** The receipt of a schedule the agent saved, with a link to edit it. */
  | { readonly kind: "schedule"; readonly key: string; readonly receipt: Extract<ThreadEvent, { readonly _tag: "schedule.saved" }> }
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
}

export const emptyTimeline = (): Timeline => ({ items: [], lastSeq: 0, runningTurn: null });

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
      timeline.items.push({ kind: "user", key: event.turnId, text: event.text, unattended: event.unattended === true });
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
    case "schedule.saved":
      timeline.items.push({ kind: "schedule", key: String(stored.seq), receipt: event });
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

/** "12.5K in · 187 out · $0.026" */
export const usageLabel = (usage: TurnUsage) =>
  [
    `${compact.format(usage.inputTokens)} in`,
    `${compact.format(usage.outputTokens)} out`,
    ...(usage.costUsd === null ? [] : [`$${usage.costUsd.toFixed(usage.costUsd < 0.1 ? 3 : 2)}`]),
  ].join(" · ");
