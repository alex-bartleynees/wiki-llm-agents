import { relative as relativePath, resolve } from "node:path";
import type { ProposedEdit } from "@wiki-agents/contracts/changes/model";
import type { RequestPrompt, TurnUsage } from "@wiki-agents/contracts/threads/model";
import { createPatch } from "diff";
import { Effect, type FileSystem } from "effect";
import type { ProviderEvent } from "../port.js";
import { changedPaths, creates } from "./permissions.js";
import type {
  CommandAction,
  CommandApprovalParams,
  ElicitationParams,
  FileUpdateChange,
  Notifications,
  PermissionsApprovalParams,
  ThreadItem,
  UserInputQuestion,
} from "./protocol.js";

/**
 * Translates one turn's Codex notifications into the app's normalised events, and
 * Codex's requests into approvals and questions.
 */

/** Longest tool input summary and tool output kept in a thread's events. */
const MAX_INPUT = 300;
const MAX_OUTPUT = 4000;

const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** A path inside the working directory, shown relative to it. */
export const shown = (path: string, cwd: string) => {
  const inside = relativePath(cwd, resolve(cwd, path));
  return inside === "" || inside.startsWith("..") ? path : inside;
};

/** The command as typed: Codex runs it as `<shell> -lc '<command>'`. */
export const unwrapShell = (command: string) => {
  const wrapped = /^(?:\S*\/)?(?:bash|zsh|sh) -l?c (.*)$/s.exec(command)?.[1];
  if (wrapped === undefined) return command;
  if (wrapped.length < 2) return wrapped;
  if (wrapped.startsWith("'") && wrapped.endsWith("'")) return wrapped.slice(1, -1).replaceAll("'\\''", "'");
  if (wrapped.startsWith('"') && wrapped.endsWith('"')) return wrapped.slice(1, -1).replace(/\\(["\\$`])/g, "$1");
  return wrapped;
};

/** The server name the thread's vault tools have in Codex; its tools show by their own names. */
export const VAULT_SERVER = "wiki_agents";

/** A command shown as what it does when Codex could tell (reading, listing, searching files). */
const commandCall = (command: string, actions: ReadonlyArray<CommandAction>, cwd: string) => {
  const first = actions[0];
  if (actions.length === 1 && first !== undefined) {
    if (first.type === "read") return { name: "read", input: shown(first.path, cwd) };
    if (first.type === "listFiles") return { name: "list", input: first.path === null ? "." : shown(first.path, cwd) };
    if (first.type === "search") return { name: "search", input: truncate([first.query, first.path === null ? null : `in ${shown(first.path, cwd)}`].filter((part) => part !== null).join(" "), MAX_INPUT) };
  }
  return { name: "command", input: truncate(unwrapShell(command), MAX_INPUT) };
};

const summariseArguments = (input: unknown) => {
  if (input === null || input === undefined || (typeof input === "object" && Object.keys(input).length === 0)) return "";
  if (typeof input === "object") {
    const record = input as Record<string, unknown>;
    for (const key of ["path", "query", "q", "url", "note", "target"]) if (typeof record[key] === "string") return truncate(record[key], MAX_INPUT);
  }
  return truncate(JSON.stringify(input), MAX_INPUT);
};

const contentText = (content: ReadonlyArray<unknown>) =>
  content
    .flatMap((part) => (typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text" ? [String((part as { text?: unknown }).text ?? "")] : []))
    .join("\n");

/** What a patch does, in a few words: `Edit Notes/Tea.md`, `Create Notes/Oolong.md`, `Change 2 files`. */
const patchTitle = (changes: ReadonlyArray<FileUpdateChange>, created: ReadonlyArray<boolean>, cwd: string) => {
  const [change] = changes;
  if (changes.length !== 1 || change === undefined) return `Change ${changes.length} files: ${changes.map((each) => shown(each.path, cwd)).join(", ")}`;
  const verb = created[0] === true ? "Create" : change.kind.type === "delete" ? "Delete" : change.kind.type === "update" && change.kind.move_path !== null ? "Move" : "Edit";
  return `${verb} ${shown(change.path, cwd)}`;
};

/** A change as a unified diff with file headers: Codex gives an added file's content, and an update's hunks without headers. */
export const changePatch = (change: FileUpdateChange, cwd: string): string => {
  const path = shown(change.path, cwd);
  switch (change.kind.type) {
    case "add":
      return createPatch(path, "", change.diff);
    case "delete":
      return createPatch(path, change.diff, "");
    case "update": {
      const to = change.kind.move_path === null ? path : shown(change.kind.move_path, cwd);
      return `--- ${path}\n+++ ${to}\n${change.diff}${change.diff.endsWith("\n") ? "" : "\n"}`;
    }
  }
};

/** A patch Codex asks to apply, with each file's diff. */
export const fileChangePrompt = Effect.fnUntraced(function* (
  changes: ReadonlyArray<FileUpdateChange>,
  cwd: string,
  reason: string | null | undefined,
): Effect.fn.Return<RequestPrompt, never, FileSystem.FileSystem> {
  const created: Array<boolean> = [];
  for (const change of changes) created.push(yield* creates(change, cwd));
  const edits = changes.map((change): ProposedEdit => ({ path: shown(change.path, cwd), patch: changePatch(change, cwd), warnings: [] }));
  return {
    _tag: "approval",
    title: patchTitle(changes, created, cwd),
    detail: [reason ?? undefined, ...edits.map((edit) => edit.patch)].filter((part) => part !== undefined && part !== "").join("\n"),
    edits,
  };
});

/** A command Codex asks to run, as typed, with where and why. */
export const commandPrompt = (params: CommandApprovalParams, cwd: string): RequestPrompt => {
  const command = unwrapShell(params.command ?? params.commandActions?.map((action) => action.command).join(" && ") ?? "");
  const where = params.cwd !== undefined && params.cwd !== null && params.cwd !== cwd ? `In ${params.cwd}` : undefined;
  return {
    _tag: "approval",
    title: `Run ${truncate(command, MAX_INPUT)}`.trim(),
    detail: [where, params.reason ?? undefined, truncate(command, MAX_OUTPUT)].filter((part) => part !== undefined && part !== "").join("\n"),
  };
};

/** Codex asks for more access than its sandbox gives (the network, more folders). */
export const permissionsPrompt = (params: PermissionsApprovalParams): RequestPrompt => ({
  _tag: "approval",
  title: "Give Codex more access",
  detail: [params.reason ?? undefined, JSON.stringify(params.permissions, null, 2)].filter((part) => part !== undefined && part !== "").join("\n"),
});

/** An MCP server asks you to confirm something (no fields to fill in). */
export const elicitationPrompt = (params: ElicitationParams): RequestPrompt => ({
  _tag: "approval",
  title: `${params.serverName} asks`,
  detail: params.message,
});

/** An elicitation the app can show: a confirmation, not a form with fields. */
export const isConfirmation = (params: ElicitationParams) =>
  params.mode === "form" && Object.keys(params.requestedSchema?.properties ?? {}).length === 0;

/** One question per request. Several at once become one numbered question; your answer goes to each of them. */
export const questionPrompt = (questions: ReadonlyArray<UserInputQuestion>): RequestPrompt => {
  const [first] = questions;
  if (questions.length === 1 && first !== undefined) return { _tag: "question", question: first.question, options: (first.options ?? []).map((option) => option.label) };
  return { _tag: "question", question: questions.map((item, index) => `${index + 1}. ${item.question}`).join("\n"), options: [] };
};

/** Tokens of the turn's model calls; input counts cached input too. */
export interface UsageTotal {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export interface TurnMapper {
  /** The normalised events for one of Codex's notifications; empty for the ones the app doesn't show. */
  readonly map: <M extends keyof Notifications>(method: M, params: Notifications[M]) => ReadonlyArray<ProviderEvent>;
  /** A file change Codex announced, by item id, for the approval it asks next. */
  readonly fileChange: (itemId: string) => ReadonlyArray<FileUpdateChange> | undefined;
}

/**
 * Replies stream from deltas; a reply that arrives only whole is sent whole. Patches
 * name the files they write, so vault changes are attributed to the turn. `deniedOutput`
 * says why a declined item didn't run.
 */
export const makeTurnMapper = (turnId: string, cwd: string, deniedOutput: (itemId: string) => string | undefined): TurnMapper => {
  const streamed = new Set<string>();
  const changes = new Map<string, ReadonlyArray<FileUpdateChange>>();
  const usage: UsageTotal = { inputTokens: 0, outputTokens: 0, calls: 0 };

  const called = (item: ThreadItem): ReadonlyArray<ProviderEvent> => {
    switch (item.type) {
      case "commandExecution":
        return [{ _tag: "tool.called", turnId, callId: item.id, ...commandCall(item.command, item.commandActions, cwd) }];
      case "fileChange": {
        changes.set(item.id, item.changes);
        const writes = changedPaths(item.changes, cwd);
        const name = item.changes.every((change) => change.kind.type === "add") ? "create" : "edit";
        return [{ _tag: "tool.called", turnId, callId: item.id, name, input: truncate(item.changes.map((change) => shown(change.path, cwd)).join(", "), MAX_INPUT), writes: [...writes] }];
      }
      case "mcpToolCall":
        return [{ _tag: "tool.called", turnId, callId: item.id, name: item.server === VAULT_SERVER ? item.tool : `${item.server}: ${item.tool}`, input: summariseArguments(item.arguments) }];
      case "webSearch":
        return [{ _tag: "tool.called", turnId, callId: item.id, name: "web search", input: truncate(item.query, MAX_INPUT) }];
      case "imageView":
        return [{ _tag: "tool.called", turnId, callId: item.id, name: "view image", input: shown(item.path, cwd) }];
      case "collabAgentToolCall":
        return [{ _tag: "tool.called", turnId, callId: item.id, name: "subagent", input: truncate(item.prompt ?? item.tool, MAX_INPUT) }];
      default:
        return [];
    }
  };

  const finished = (item: ThreadItem): ReadonlyArray<ProviderEvent> => {
    const denied = (status: string) => (status === "declined" ? (deniedOutput(item.id) ?? "Denied.") : undefined);
    switch (item.type) {
      case "agentMessage":
        return streamed.has(item.id) || item.text === "" ? [] : [{ _tag: "message.delta", turnId, messageId: item.id, text: item.text }];
      case "commandExecution":
        return [
          {
            _tag: "tool.finished",
            turnId,
            callId: item.id,
            status: item.status === "completed" && (item.exitCode === null || item.exitCode === 0) ? "succeeded" : "failed",
            output: truncate(denied(item.status) ?? item.aggregatedOutput ?? "", MAX_OUTPUT),
          },
        ];
      case "fileChange": {
        const writes = changedPaths(item.changes, cwd);
        const done = item.status === "completed";
        const output = denied(item.status) ?? (done ? `${item.changes.length === 1 ? "1 file" : `${item.changes.length} files`} changed` : "The patch didn't apply.");
        return [{ _tag: "tool.finished", turnId, callId: item.id, status: done ? "succeeded" : "failed", output, writes: [...writes] }];
      }
      case "mcpToolCall":
        return [
          {
            _tag: "tool.finished",
            turnId,
            callId: item.id,
            status: item.status === "completed" && item.error === null ? "succeeded" : "failed",
            output: truncate(item.error?.message ?? contentText(item.result?.content ?? []), MAX_OUTPUT),
          },
        ];
      case "collabAgentToolCall":
        return [{ _tag: "tool.finished", turnId, callId: item.id, status: item.status === "completed" ? "succeeded" : "failed", output: "" }];
      case "webSearch":
      case "imageView":
        return [{ _tag: "tool.finished", turnId, callId: item.id, status: "succeeded", output: "" }];
      default:
        return [];
    }
  };

  const map = <M extends keyof Notifications>(method: M, raw: Notifications[M]): ReadonlyArray<ProviderEvent> => {
    switch (method) {
      case "item/agentMessage/delta": {
        const params = raw as Notifications["item/agentMessage/delta"];
        streamed.add(params.itemId);
        return params.delta === "" ? [] : [{ _tag: "message.delta", turnId, messageId: params.itemId, text: params.delta }];
      }
      case "item/started":
        return called((raw as Notifications["item/started"]).item);
      case "item/completed":
        return finished((raw as Notifications["item/completed"]).item);
      case "thread/tokenUsage/updated": {
        const last = (raw as Notifications["thread/tokenUsage/updated"]).tokenUsage.last;
        usage.inputTokens += last.inputTokens;
        usage.outputTokens += last.outputTokens;
        usage.calls += 1;
        return [];
      }
      case "turn/completed": {
        const turn = (raw as Notifications["turn/completed"]).turn;
        const outcome = turn.status === "completed" ? "completed" : turn.status === "interrupted" ? "interrupted" : "failed";
        const reason =
          outcome !== "failed"
            ? null
            : [turn.error?.message, turn.error?.additionalDetails].filter((part) => part !== undefined && part !== null && part !== "").join("\n") || "Codex's turn failed.";
        const spent: TurnUsage | null = usage.calls === 0 ? null : { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: null };
        return [{ _tag: "turn.finished", turnId, outcome, usage: spent, reason }];
      }
      default:
        return [];
    }
  };

  return { map, fileChange: (itemId) => changes.get(itemId) };
};
