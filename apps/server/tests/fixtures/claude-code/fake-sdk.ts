import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { HookInput, McpServerConfig, ModelInfo, Options, PermissionResult, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeCodeSdk, ClaudeQuery } from "../../../src/features/providers/claude-code/sdk.js";
import { type Fixture, HOME, SESSION, VAULT } from "./fixture.js";

export const loadFixture = (scenario: string): Fixture =>
  JSON.parse(readFileSync(new URL(`./${scenario}.json`, import.meta.url), "utf8")) as Fixture;

export const FAKE_MODELS: ReadonlyArray<ModelInfo> = [
  { value: "default", displayName: "Default (recommended)", description: "The model Claude Code picks" },
  { value: "haiku", displayName: "Haiku", description: "Fastest" },
];

export interface PlayOptions {
  /** Text the app adds after each recorded prompt (supplied notes). */
  readonly promptSuffixes?: ReadonlyArray<string>;
  /** Claude Code exits with an error after this many steps of the first turn played. */
  readonly crashAfter?: number;
  /** Why the vault tools' MCP server fails to connect; it connects when unset. */
  readonly mcpError?: string;
}

/** What the adapter asked of Claude Code, in order. */
export type FakeCall =
  | { readonly call: "query"; readonly options: Options }
  | { readonly call: "send"; readonly text: string }
  | { readonly call: "interrupt" | "close" }
  | { readonly call: "setModel"; readonly model: string | undefined }
  | { readonly call: "setMcpServers"; readonly servers: Record<string, McpServerConfig> }
  | { readonly call: "hook"; readonly toolName: string; readonly decision: string }
  | { readonly call: "permission"; readonly toolName: string; readonly result: PermissionResult };

const decisionOf = (output: unknown) => {
  const specific = (output as { readonly hookSpecificOutput?: { readonly permissionDecision?: string } }).hookSpecificOutput;
  return specific?.permissionDecision ?? "defer";
};

/**
 * Claude Code playing a recorded conversation: each message the adapter sends plays
 * the next recorded turn, through the adapter's own hook and `canUseTool` (which must
 * answer as they did when it was recorded; a different answer ends the turn with an
 * error saying so), pausing at a recorded Stop until the adapter presses it. A new
 * process (a restart) carries on with the next turn, as a resumed session would.
 */
export const makeFakeSdk = () => {
  const calls: Array<FakeCall> = [];
  const saved = new Set<string>();
  let fixture: Fixture | undefined;
  let root = "";
  let options: PlayOptions = {};
  let turn = 0;
  let crashes = 0;

  const restore = (value: unknown, sessionId: string): unknown =>
    JSON.parse(JSON.stringify(value).replaceAll(VAULT, root).replaceAll(SESSION, sessionId).replaceAll(HOME, homedir()));

  const query = ({ prompt, options: queryOptions }: { readonly prompt: AsyncIterable<unknown>; readonly options: Options }): ClaudeQuery => {
    calls.push({ call: "query", options: queryOptions });
    const sessionId = queryOptions.resume ?? queryOptions.sessionId ?? "";
    const hook = queryOptions.hooks?.PreToolUse?.[0]?.hooks[0];
    const canUseTool = queryOptions.canUseTool;
    let closed = false;
    let pressed: (() => void) | undefined;
    let stopped = false;
    const waitForStop = () =>
      stopped
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            pressed = resolve;
          });

    async function* play(): AsyncGenerator<SDKMessage> {
      for await (const sent of prompt) {
        if (closed) return;
        const content = (sent as { readonly message: { readonly content: string } }).message.content;
        calls.push({ call: "send", text: content });
        if (fixture === undefined) throw new Error("no fixture loaded");
        const recorded = fixture.turns[turn];
        if (recorded === undefined) throw new Error(`the fixture has no turn ${turn + 1}`);
        const expected = recorded.prompt + (options.promptSuffixes?.[turn] ?? "");
        turn += 1;
        if (content !== expected) throw new Error(`sent ${JSON.stringify(content)}, recorded ${JSON.stringify(expected)}`);
        stopped = false;
        let played = 0;
        for (const step of recorded.steps) {
          if (closed) return;
          if (options.crashAfter !== undefined && crashes === 0 && played++ >= options.crashAfter) {
            crashes += 1;
            throw new Error("Claude Code process exited with code 1");
          }
          if ("message" in step) {
            const message = restore(step.message, sessionId) as SDKMessage;
            if (message.type === "result") saved.add(sessionId);
            yield message;
          } else if ("hook" in step) {
            if (hook === undefined) throw new Error("the adapter gave no PreToolUse hook");
            const input = {
              hook_event_name: "PreToolUse",
              session_id: sessionId,
              transcript_path: "",
              cwd: root,
              tool_name: step.hook.toolName,
              tool_input: restore(step.hook.toolInput, sessionId),
              tool_use_id: step.hook.toolUseId,
            } as unknown as HookInput;
            const decision = decisionOf(await hook(input, step.hook.toolUseId, { signal: new AbortController().signal }));
            calls.push({ call: "hook", toolName: step.hook.toolName, decision });
            if (decision !== step.decision) throw new Error(`the hook decided ${decision} for ${step.hook.toolName}; recorded ${step.decision}`);
          } else if ("permission" in step) {
            if (canUseTool === undefined) throw new Error("the adapter gave no canUseTool");
            const result = await canUseTool(step.permission.toolName, restore(step.permission.toolInput, sessionId) as Record<string, unknown>, {
              signal: new AbortController().signal,
              toolUseID: step.permission.toolUseId,
              requestId: step.permission.toolUseId,
              ...(step.permission.blockedPath === undefined ? {} : { blockedPath: restore(step.permission.blockedPath, sessionId) as string }),
            });
            if (closed) return;
            if (result === null) throw new Error("canUseTool answered nothing");
            calls.push({ call: "permission", toolName: step.permission.toolName, result });
            if (result.behavior !== step.behavior) throw new Error(`canUseTool answered ${result.behavior} for ${step.permission.toolName}; recorded ${step.behavior}`);
          } else {
            await waitForStop();
          }
        }
      }
    }

    const messages = play();
    return {
      [Symbol.asyncIterator]: () => messages,
      interrupt: async () => {
        calls.push({ call: "interrupt" });
        stopped = true;
        pressed?.();
      },
      setModel: async (model) => {
        calls.push({ call: "setModel", model });
      },
      supportedModels: async () => FAKE_MODELS,
      setMcpServers: async (servers) => {
        calls.push({ call: "setMcpServers", servers });
        const failed = options.mcpError;
        return { added: Object.keys(servers), removed: [], errors: failed === undefined ? {} : Object.fromEntries(Object.keys(servers).map((name) => [name, failed])) };
      },
      close: () => {
        if (closed) return;
        closed = true;
        calls.push({ call: "close" });
        pressed?.();
      },
    };
  };

  const sdk: ClaudeCodeSdk = {
    query: (params) => query(params as { readonly prompt: AsyncIterable<unknown>; readonly options: Options }),
    sessionExists: async (sessionId) => saved.has(sessionId),
  };

  return {
    sdk,
    calls,
    /** Plays `next` from its first turn, in `vault`, and forgets earlier calls. */
    load: (next: Fixture, vault: string, play: PlayOptions = {}) => {
      fixture = next;
      root = vault;
      options = play;
      calls.length = 0;
      turn = 0;
      crashes = 0;
    },
    /** The `query` calls' options, in order. */
    queries: () => calls.flatMap((call) => (call.call === "query" ? [call.options] : [])),
  };
};

export type FakeSdk = ReturnType<typeof makeFakeSdk>;
