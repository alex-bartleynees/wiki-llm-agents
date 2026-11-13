import { relative as relativePath, resolve } from "node:path";
import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ProposedEdit } from "@wiki-agents/contracts/changes/model";
import type { RequestPrompt, TurnUsage } from "@wiki-agents/contracts/threads/model";
import { createPatch } from "diff";
import { Effect, FileSystem } from "effect";
import { ENTRY_PREFIX } from "../../mcp/vault-tools.js";
import { todoSteps } from "../plan.js";
import type { ProviderEvent } from "../port.js";
import { writeTarget } from "./permissions.js";

/**
 * Translates one turn's Claude Code messages into the app's normalised events. Pure
 * except for the approval prompts, which read the file an edit changes.
 */

/** Longest tool input summary and tool output kept in a thread's events. */
const MAX_INPUT = 300;
const MAX_OUTPUT = 4000;

const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

const field = (input: unknown, key: string): string | undefined => {
  if (typeof input !== "object" || input === null || !(key in input)) return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
};

/** A path inside the working directory, shown relative to it. */
const shown = (path: string, cwd: string) => {
  const inside = relativePath(cwd, resolve(cwd, path));
  return inside === "" || inside.startsWith("..") ? path : inside;
};

/** A short, readable summary of a tool's input: the path, command, pattern or URL when there is one. */
export const summariseInput = (input: unknown, cwd: string): string => {
  const path = field(input, "file_path") ?? field(input, "notebook_path");
  if (path !== undefined) return shown(path, cwd);
  const command = field(input, "command");
  if (command !== undefined) return truncate(command, MAX_INPUT);
  const pattern = field(input, "pattern") ?? field(input, "query") ?? field(input, "url") ?? field(input, "description") ?? field(input, "path");
  if (pattern !== undefined) return truncate(pattern, MAX_INPUT);
  if (input === undefined || (typeof input === "object" && input !== null && Object.keys(input).length === 0)) return "";
  return truncate(JSON.stringify(input), MAX_INPUT);
};

/** The vault tools' MCP prefix, `mcp__wiki-agents-<thread id>__`. */
const VAULT_TOOLS = new RegExp(`^mcp__${ENTRY_PREFIX}[0-9a-f-]+__`);

/** A tool's name as shown: the vault tools by their own names (`vault_search`), other MCP tools as `server: tool`. */
export const toolLabel = (name: string) => name.replace(VAULT_TOOLS, "").replace(/^mcp__(.+?)__/, "$1: ");

interface Replacement {
  readonly old_string: string;
  readonly new_string: string;
  readonly replace_all?: boolean;
}

const replacements = (toolName: string, input: unknown): ReadonlyArray<Replacement> | undefined => {
  if (typeof input !== "object" || input === null) return undefined;
  const record = input as Record<string, unknown>;
  const valid = (value: unknown): value is Replacement =>
    typeof value === "object" && value !== null && typeof (value as Replacement).old_string === "string" && typeof (value as Replacement).new_string === "string";
  if (toolName === "Edit") return valid(record) ? [record] : undefined;
  if (toolName === "MultiEdit" && Array.isArray(record.edits)) return record.edits.every(valid) ? record.edits : undefined;
  return undefined;
};

/** The file after an `Edit` or `MultiEdit`, as Claude Code would write it; undefined when a string isn't there. */
export const applyReplacements = (before: string, edits: ReadonlyArray<Replacement>): string | undefined => {
  let text = before;
  for (const edit of edits) {
    if (edit.old_string === "" || !text.includes(edit.old_string)) return undefined;
    text = edit.replace_all === true ? text.split(edit.old_string).join(edit.new_string) : text.replace(edit.old_string, () => edit.new_string);
  }
  return text;
};

/**
 * The change a writing tool proposes, as a unified diff of the file as it is now;
 * undefined for other tools, or when it can't be worked out.
 */
export const proposedEdit = Effect.fnUntraced(function* (toolName: string, input: unknown, cwd: string) {
  const target = writeTarget(toolName, input, cwd);
  if (target === undefined) return undefined;
  const fs = yield* FileSystem.FileSystem;
  const current = yield* fs.readFileString(target).pipe(Effect.option);
  const before = current._tag === "Some" ? current.value : "";
  const content = field(input, "content");
  const edits = replacements(toolName, input);
  const after = toolName === "Write" && content !== undefined ? content : edits !== undefined ? applyReplacements(before, edits) : undefined;
  if (after === undefined) return undefined;
  const path = shown(target, cwd);
  const edit: ProposedEdit = { path, patch: createPatch(path, before, after), warnings: [] };
  return edit;
});

/** What the agent asks to do, with the change, command or input as plain text. */
export const approvalPrompt = Effect.fnUntraced(function* (
  toolName: string,
  input: unknown,
  cwd: string,
  context: { readonly blockedPath?: string | undefined; readonly decisionReason?: string | undefined } = {},
) {
  const edit = yield* proposedEdit(toolName, input, cwd);
  const target = writeTarget(toolName, input, cwd);
  const fs = yield* FileSystem.FileSystem;
  const creates = toolName === "Write" && target !== undefined && !(yield* fs.exists(target).pipe(Effect.orElseSucceed(() => true)));
  const verb = creates
    ? "Create"
    : (({ Edit: "Edit", MultiEdit: "Edit", Write: "Write", NotebookEdit: "Edit", Bash: "Run", PowerShell: "Run", Monitor: "Watch", WebFetch: "Fetch", WebSearch: "Search the web for", Read: "Read", Glob: "List", Grep: "Search", Agent: "Start a subagent:" } as Readonly<Record<string, string>>)[toolName] ??
      `Use ${toolLabel(toolName)} on`);
  const summary = summariseInput(input, cwd);
  const notes = [context.blockedPath === undefined ? undefined : `Outside the working folder: ${context.blockedPath}`, context.decisionReason].filter(
    (note): note is string => note !== undefined && note !== "",
  );
  const body = field(input, "command") ?? field(input, "prompt") ?? field(input, "plan") ?? (typeof input === "object" ? JSON.stringify(input, null, 2) : String(input));
  const prompt: RequestPrompt = {
    _tag: "approval",
    title: `${verb} ${summary}`.trim(),
    detail: [...notes, edit === undefined ? truncate(body, MAX_OUTPUT) : edit.patch].join("\n"),
    ...(edit === undefined ? {} : { edits: [edit] }),
  };
  return prompt;
});

interface AskedQuestion {
  readonly question: string;
  readonly options: ReadonlyArray<{ readonly label: string }>;
}

/** The questions of an `AskUserQuestion` call; empty when its input isn't what Claude Code sends. */
export const askedQuestions = (input: unknown): ReadonlyArray<AskedQuestion> => {
  const questions = typeof input === "object" && input !== null ? (input as { readonly questions?: unknown }).questions : undefined;
  if (!Array.isArray(questions)) return [];
  return questions.flatMap((item: unknown): Array<AskedQuestion> => {
    const question = field(item, "question");
    if (question === undefined) return [];
    const options = (item as { readonly options?: unknown }).options;
    return [{ question, options: Array.isArray(options) ? options.flatMap((option: unknown) => { const label = field(option, "label"); return label === undefined ? [] : [{ label }]; }) : [] }];
  });
};

/**
 * One question per call. Several questions at once become one numbered question;
 * your answer goes to each of them.
 */
export const questionPrompt = (questions: ReadonlyArray<AskedQuestion>): RequestPrompt => {
  const first = questions[0];
  if (questions.length === 1 && first !== undefined) return { _tag: "question", question: first.question, options: first.options.map((option) => option.label) };
  return { _tag: "question", question: questions.map((item, index) => `${index + 1}. ${item.question}`).join("\n"), options: [] };
};

/** `AskUserQuestion`'s input with your answer to each question, as Claude Code expects it back. */
export const answeredInput = (input: Record<string, unknown>, text: string): Record<string, unknown> => ({
  ...input,
  answers: Object.fromEntries(askedQuestions(input).map((item) => [item.question, text])),
});

const resultText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part: unknown) => (field(part, "type") === "text" ? [field(part, "text") ?? ""] : [])).join("\n");
};

/** Why a turn failed, from its result. */
const failure = (result: SDKResultMessage): string => {
  if (result.subtype === "success") return result.result.trim() || "Claude Code's turn failed.";
  switch (result.subtype) {
    case "error_max_turns":
      return "Claude Code stopped: the turn reached its maximum number of steps.";
    case "error_max_budget_usd":
      return "Claude Code stopped: the turn reached its budget.";
    default:
      return result.errors.join("\n").trim() || "Claude Code's turn failed.";
  }
};

/** Tokens of one turn's result: input counts cache reads and writes too. */
export const resultUsage = (result: SDKResultMessage, costUsd: number | null): TurnUsage => ({
  inputTokens: result.usage.input_tokens + result.usage.cache_read_input_tokens + result.usage.cache_creation_input_tokens,
  outputTokens: result.usage.output_tokens,
  costUsd,
});

export interface TurnMapper {
  /** The normalised events for one of the conversation's messages; empty for the ones the app doesn't show. */
  readonly map: (message: SDKMessage) => ReadonlyArray<ProviderEvent>;
}

/**
 * `cost` gives a result's cost in USD, or null when it isn't billed per token (a
 * subscription). Replies stream from partial messages; a reply that arrives only
 * whole (an API error, say) is sent whole. Subagents' tool calls are shown, their
 * text isn't.
 */
export const makeTurnMapper = (turnId: string, cwd: string, cost: (result: SDKResultMessage) => number | null): TurnMapper => {
  let messageId: string | undefined;
  const streamed = new Set<string>();
  /** `TodoWrite` calls shown as the plan, whose results aren't shown. */
  const planCalls = new Set<string>();

  const map = (message: SDKMessage): ReadonlyArray<ProviderEvent> => {
    switch (message.type) {
      case "stream_event": {
        if (message.parent_tool_use_id !== null) return [];
        const event = message.event;
        if (event.type === "message_start") messageId = event.message.id;
        if (event.type !== "content_block_delta" || event.delta.type !== "text_delta" || messageId === undefined) return [];
        streamed.add(messageId);
        return [{ _tag: "message.delta", turnId, messageId: `${messageId}:${event.index}`, text: event.delta.text }];
      }
      case "assistant": {
        const subagent = message.parent_tool_use_id !== null;
        return message.message.content.flatMap((block, index): Array<ProviderEvent> => {
          if (block.type === "text" && !subagent && !streamed.has(message.message.id) && block.text !== "") {
            return [{ _tag: "message.delta", turnId, messageId: `${message.message.id}:${index}`, text: block.text }];
          }
          if (block.type !== "tool_use" && block.type !== "mcp_tool_use" && block.type !== "server_tool_use") return [];
          const steps = block.type === "tool_use" && block.name === "TodoWrite" && !subagent ? todoSteps(block.input) : undefined;
          if (steps !== undefined) {
            planCalls.add(block.id);
            return [{ _tag: "plan.updated", turnId, steps }];
          }
          const target = block.type === "tool_use" ? writeTarget(block.name, block.input, cwd) : undefined;
          return [
            {
              _tag: "tool.called",
              turnId,
              callId: block.id,
              name: toolLabel(block.name),
              input: summariseInput(block.input, cwd),
              ...(target === undefined ? {} : { writes: [target] }),
            },
          ];
        });
      }
      case "user": {
        const content = message.message.content;
        if (typeof content === "string") return [];
        return content.flatMap((block): Array<ProviderEvent> =>
          block.type === "tool_result" && !planCalls.has(block.tool_use_id)
            ? [
                {
                  _tag: "tool.finished",
                  turnId,
                  callId: block.tool_use_id,
                  status: block.is_error === true ? "failed" : "succeeded",
                  output: truncate(resultText(block.content), MAX_OUTPUT),
                },
              ]
            : [],
        );
      }
      case "result": {
        const completed = message.subtype === "success" && !message.is_error;
        return [
          {
            _tag: "turn.finished",
            turnId,
            outcome: completed ? "completed" : "failed",
            usage: resultUsage(message, cost(message)),
            reason: completed ? null : failure(message),
          },
        ];
      }
      default:
        return [];
    }
  };

  return { map };
};
