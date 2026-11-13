import { isAbsolute, resolve } from "node:path";
import type { ProposedEdit } from "@wiki-agents/contracts/changes/model";
import type { RequestPrompt, TurnUsage } from "@wiki-agents/contracts/threads/model";
import { todoSteps } from "../plan.js";
import type { ProviderEvent } from "../port.js";
import type { OpenCodeEvent } from "./api.js";

/**
 * Translates one turn's OpenCode events into the app's normalised events. Pure:
 * the adapter feeds it the session's events in order and sends what it returns.
 */

type EventOf<T extends OpenCodeEvent["type"]> = Extract<OpenCodeEvent, { readonly type: T }>;

/** Longest tool input summary and tool output kept in a thread's events. */
const MAX_INPUT = 300;
const MAX_OUTPUT = 4000;

const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** The session an event belongs to, if any. Forms carry it inside the form. */
export const sessionOf = (event: OpenCodeEvent): string | undefined => {
  const data = (event as { readonly data?: unknown }).data;
  if (typeof data !== "object" || data === null) return undefined;
  if ("sessionID" in data && typeof data.sessionID === "string") return data.sessionID;
  if ("form" in data && typeof data.form === "object" && data.form !== null && "sessionID" in data.form) {
    return typeof data.form.sessionID === "string" ? data.form.sessionID : undefined;
  }
  return undefined;
};

/** A path inside the working directory, shown relative to it. */
const relative = (path: string, directory: string) =>
  path.startsWith(`${directory}/`) ? path.slice(directory.length + 1) : path;

const field = (input: unknown, key: string): string | undefined => {
  if (typeof input !== "object" || input === null || !(key in input)) return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
};

/** A short, readable summary of a tool's input: the path or command when there is one. */
export const summariseInput = (input: unknown, directory: string): string => {
  const path = field(input, "path") ?? field(input, "filePath") ?? field(input, "file");
  if (path !== undefined) return relative(path, directory);
  const command = field(input, "command");
  if (command !== undefined) return truncate(command, MAX_INPUT);
  const pattern = field(input, "pattern") ?? field(input, "query") ?? field(input, "url");
  if (pattern !== undefined) return truncate(pattern, MAX_INPUT);
  if (input === undefined || (typeof input === "object" && input !== null && Object.keys(input).length === 0)) return "";
  return truncate(JSON.stringify(input), MAX_INPUT);
};

const contentText = (content: ReadonlyArray<{ readonly type: string }> | undefined) =>
  (content ?? []).flatMap((part) => (part.type === "text" && "text" in part && typeof part.text === "string" ? [part.text] : [])).join("\n");

const VERBS: Readonly<Record<string, string>> = {
  edit: "Edit",
  write: "Write",
  shell: "Run",
  bash: "Run",
  webfetch: "Fetch",
  websearch: "Search the web for",
  read: "Read",
  external_directory: "Work outside the vault in",
};

/** `metadata.files` of a permission or tool result: each file OpenCode changes, with its patch. */
const metadataFiles = (metadata: unknown): ReadonlyArray<{ readonly file: string; readonly patch: string | undefined }> => {
  const files = typeof metadata === "object" && metadata !== null && "files" in metadata ? metadata.files : undefined;
  if (!Array.isArray(files)) return [];
  return files.flatMap((file: unknown) => {
    const path = field(file, "file") ?? field(file, "filePath") ?? field(file, "path");
    return path === undefined ? [] : [{ file: path, patch: field(file, "patch") }];
  });
};

/** What the agent wants to do, with the change or command as plain text; file edits also as `edits`. */
export const approvalPrompt = (event: EventOf<"permission.asked">): RequestPrompt => {
  const { action, resources, metadata } = event.data;
  const verb = VERBS[action] ?? `Use ${action} on`;
  const edits = metadataFiles(metadata).flatMap((file): Array<ProposedEdit> =>
    file.patch === undefined ? [] : [{ path: file.file, patch: file.patch, warnings: [] }],
  );
  const command = field(metadata, "command") ?? field(metadata, "description");
  const detail = edits.length > 0 ? edits.map((edit) => edit.patch).join("\n") : (command ?? resources.join("\n"));
  return {
    _tag: "approval",
    title: `${verb} ${resources.join(", ")}`.trim(),
    detail,
    ...(edits.length > 0 ? { edits } : {}),
  };
};

/** Tools that write the files named in their input. */
const WRITING_TOOLS = new Set(["edit", "write", "multiedit", "patch", "apply_patch"]);

/** Files named in an `apply_patch` patch (`*** Update File: path`, `*** Move to: path`...). */
const patchFiles = (patch: string) =>
  [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map((match) => match[1]!.trim());

/** Absolute paths a tool call says it writes, from its input. */
export const inputWrites = (name: string, input: unknown, directory: string): ReadonlyArray<string> => {
  if (!WRITING_TOOLS.has(name)) return [];
  const path = field(input, "path") ?? field(input, "filePath") ?? field(input, "file");
  const patch = field(input, "patchText") ?? field(input, "patch");
  const paths = [...(path === undefined ? [] : [path]), ...(patch === undefined ? [] : patchFiles(patch))];
  return paths.map((item) => (isAbsolute(item) ? item : resolve(directory, item)));
};

/**
 * One question per form. A form with several fields (the agent asked several
 * questions at once) becomes one numbered question; your answer goes to each field.
 */
export const questionPrompt = (event: EventOf<"form.created">): RequestPrompt => {
  const { form } = event.data;
  const fields = form.fields;
  const describe = (item: (typeof fields)[number]) => item.description ?? item.title ?? form.title;
  const first = fields[0];
  if (fields.length === 1 && first !== undefined) {
    const options = "options" in first && first.options !== undefined ? first.options.map((option) => option.label) : [];
    return { _tag: "question", question: describe(first), options };
  }
  return { _tag: "question", question: fields.map((item, index) => `${index + 1}. ${describe(item)}`).join("\n"), options: [] };
};

/** The form's answer: your text for every field it asks. */
export const formAnswer = (event: EventOf<"form.created">, text: string): Record<string, string> =>
  Object.fromEntries(event.data.form.fields.map((item) => [item.key, text]));

export interface TurnMapper {
  /** The normalised events for one of the session's events; empty for the ones the app doesn't show. */
  readonly map: (event: OpenCodeEvent) => ReadonlyArray<ProviderEvent>;
  /** Tokens and cost of the steps seen so far. */
  readonly usage: () => TurnUsage;
}

export const makeTurnMapper = (turnId: string, directory: string): TurnMapper => {
  const toolNames = new Map<string, string>();
  /** `todowrite` calls shown as the plan, whose results aren't shown. */
  const planCalls = new Set<string>();
  const totals = { input: 0, output: 0, cost: 0 };

  const addStep = (step: {
    readonly cost?: number | undefined;
    readonly tokens?:
      | { readonly input: number; readonly output: number; readonly reasoning: number; readonly cache: { readonly read: number; readonly write: number } }
      | undefined;
  }) => {
    if (step.tokens !== undefined) {
      totals.input += step.tokens.input + step.tokens.cache.read + step.tokens.cache.write;
      totals.output += step.tokens.output + step.tokens.reasoning;
    }
    totals.cost += step.cost ?? 0;
  };

  const usage = (): TurnUsage => ({ inputTokens: totals.input, outputTokens: totals.output, costUsd: totals.cost });

  const finished = (outcome: "completed" | "failed" | "interrupted", reason: string | null): ProviderEvent => ({
    _tag: "turn.finished",
    turnId,
    outcome,
    usage: usage(),
    reason,
  });

  const map = (event: OpenCodeEvent): ReadonlyArray<ProviderEvent> => {
    switch (event.type) {
      case "session.text.delta":
        return [{ _tag: "message.delta", turnId, messageId: `${event.data.assistantMessageID}:${event.data.ordinal}`, text: event.data.delta }];
      case "session.tool.input.started":
        toolNames.set(event.data.id, event.data.name);
        return [];
      case "session.tool.called": {
        const name = toolNames.get(event.data.id) ?? "tool";
        const steps = name === "todowrite" ? todoSteps(event.data.input) : undefined;
        if (steps !== undefined) {
          planCalls.add(event.data.id);
          return [{ _tag: "plan.updated", turnId, steps }];
        }
        const writes = inputWrites(name, event.data.input, directory);
        return [
          {
            _tag: "tool.called",
            turnId,
            callId: event.data.id,
            name,
            input: summariseInput(event.data.input, directory),
            ...(writes.length > 0 ? { writes } : {}),
          },
        ];
      }
      case "session.tool.success": {
        if (planCalls.has(event.data.id)) return [];
        const metadata = (event.data as { readonly metadata?: unknown }).metadata;
        const writes = metadataFiles(metadata).map(({ file }) => (isAbsolute(file) ? file : resolve(directory, file)));
        return [
          {
            _tag: "tool.finished",
            turnId,
            callId: event.data.id,
            status: "succeeded",
            output: truncate(contentText(event.data.content), MAX_OUTPUT),
            ...(writes.length > 0 ? { writes } : {}),
          },
        ];
      }
      case "session.tool.failed":
        if (planCalls.has(event.data.id)) return [];
        return [{ _tag: "tool.finished", turnId, callId: event.data.id, status: "failed", output: event.data.error.message }];
      case "permission.asked":
        return [{ _tag: "request.opened", turnId, requestId: event.data.id, prompt: approvalPrompt(event) }];
      case "form.created":
        return [{ _tag: "request.opened", turnId, requestId: event.data.form.id, prompt: questionPrompt(event) }];
      case "session.step.ended":
      case "session.step.failed":
        addStep(event.data);
        return [];
      case "session.execution.succeeded":
        return [finished("completed", null)];
      case "session.execution.failed":
        return [finished("failed", event.data.error.message)];
      case "session.execution.interrupted":
        return [finished("interrupted", event.data.reason === "user" ? null : `OpenCode stopped the turn (${event.data.reason}).`)];
      default:
        return [];
    }
  };

  return { map, usage };
};
