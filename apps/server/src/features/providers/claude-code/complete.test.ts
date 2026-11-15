import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { makeClaudeCodeAdapter } from "./adapter.js";
import type { ClaudeCodeSdk, QueryParams } from "./sdk.js";

/** Claude Code answering one message with `result`, after reporting how it is signed in. */
const stubSdk = (messages: ReadonlyArray<Record<string, unknown>>) => {
  const calls: Array<{ readonly params: QueryParams; prompts: Array<unknown>; closed: boolean }> = [];
  const sdk: ClaudeCodeSdk = {
    sessionExists: async () => false,
    query: (params) => {
      const call = { params, prompts: [] as Array<unknown>, closed: false };
      calls.push(call);
      return {
        async *[Symbol.asyncIterator]() {
          for await (const message of params.prompt) {
            call.prompts.push(message.message.content);
            for (const answer of messages) yield answer as unknown as SDKMessage;
            return;
          }
        },
        interrupt: async () => undefined,
        setModel: async () => undefined,
        supportedModels: async () => [],
        setMcpServers: async () => ({ added: [], removed: [], errors: {} }),
        close: () => {
          call.closed = true;
        },
      };
    },
  };
  return { sdk, calls };
};

const init = (apiKeySource: string) => ({ type: "system", subtype: "init", apiKeySource });
const result = (fields: Record<string, unknown>) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "Add tick boxes",
  total_cost_usd: 0.0021,
  usage: { input_tokens: 800, output_tokens: 12, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
  ...fields,
});

const adapterWith = (sdk: ClaudeCodeSdk) =>
  makeClaudeCodeAdapter({
    sdk,
    // Any executable that exists: the stub never runs it.
    binary: process.execPath,
    installedVersion: () => Effect.succeed("2.1.316"),
    authStatus: () => Effect.succeed({ loggedIn: true, account: null }),
  });

const input = { cwd: "/tmp", model: "haiku", system: "You write commit messages.", prompt: "Files to commit (1):\n- modified app.ts" };

describe("Claude Code one-shot call", () => {
  it.effect("asks with no tools, settings or saved session, and gives the answer with its cost on an API key", () =>
    Effect.gen(function* () {
      const { sdk, calls } = stubSdk([init("ANTHROPIC_API_KEY"), result({})]);
      const adapter = yield* adapterWith(sdk);
      const completion = yield* adapter.complete!(input);
      expect(completion).toEqual({ text: "Add tick boxes", usage: { inputTokens: 900, outputTokens: 12, costUsd: 0.0021 } });
      const [call] = calls;
      expect(call!.params.options).toMatchObject({
        cwd: "/tmp",
        model: "haiku",
        systemPrompt: "You write commit messages.",
        tools: [],
        settingSources: [],
        mcpServers: {},
        strictMcpConfig: true,
        maxTurns: 1,
        persistSession: false,
      });
      expect(call!.prompts).toEqual([input.prompt]);
      expect(call!.closed).toBe(true);
    }));

  it.effect("reports no cost on a subscription, leaves the model out for the default, and fails on an error result", () =>
    Effect.gen(function* () {
      const subscription = stubSdk([init("none"), result({})]);
      const completion = yield* (yield* adapterWith(subscription.sdk)).complete!({ ...input, model: null });
      expect(completion.usage?.costUsd).toBeNull();
      expect("model" in subscription.calls[0]!.params.options).toBe(false);

      const failing = stubSdk([init("none"), result({ subtype: "error_during_execution", is_error: true, errors: ["Overloaded"] })]);
      const error = yield* Effect.flip((yield* adapterWith(failing.sdk)).complete!(input));
      expect(error.message).toBe("Claude Code didn't answer: Overloaded");
      expect(failing.calls[0]!.closed).toBe(true);
    }));
});
