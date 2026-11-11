import { getSessionInfo, type McpServerConfig, type McpSetServersResult, type ModelInfo, type Options, query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * The part of the Claude Agent SDK the adapter uses. Tests swap it for one that plays
 * recorded conversations (`tests/fixtures/claude-code/fake-sdk.ts`); the recorder
 * wraps the real one.
 */

/** A running Claude Code process for one conversation, fed messages through `prompt`. */
export interface ClaudeQuery extends AsyncIterable<SDKMessage> {
  readonly interrupt: () => Promise<unknown>;
  readonly setModel: (model?: string) => Promise<void>;
  readonly supportedModels: () => Promise<ReadonlyArray<ModelInfo>>;
  /** Replaces the servers the app added; resolves once they connected or failed. */
  readonly setMcpServers: (servers: Record<string, McpServerConfig>) => Promise<McpSetServersResult>;
  /** Ends the process. */
  readonly close: () => void;
}

export interface QueryParams {
  readonly prompt: AsyncIterable<SDKUserMessage>;
  readonly options: Options;
}

export interface ClaudeCodeSdk {
  readonly query: (params: QueryParams) => ClaudeQuery;
  /** Claude Code has the session's transcript for `cwd`, so `resume` can continue it. */
  readonly sessionExists: (sessionId: string, cwd: string) => Promise<boolean>;
}

export const ClaudeCodeSdkLive: ClaudeCodeSdk = {
  query: ({ prompt, options }) => query({ prompt, options }),
  sessionExists: async (sessionId, cwd) => (await getSessionInfo(sessionId, { dir: cwd })) !== undefined,
};

/**
 * Messages for a conversation, pushed as the user sends them. Claude Code keeps
 * reading until it is closed, so one process serves every turn.
 */
export const makeInput = () => {
  const items: Array<SDKUserMessage> = [];
  let wake: (() => void) | undefined;
  let closed = false;
  const iterable: AsyncIterable<SDKUserMessage> = {
    async *[Symbol.asyncIterator]() {
      while (true) {
        const next = items.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = undefined;
      }
    },
  };
  return {
    iterable,
    push: (message: SDKUserMessage) => {
      items.push(message);
      wake?.();
    },
    close: () => {
      closed = true;
      wake?.();
    },
  };
};

export type Input = ReturnType<typeof makeInput>;

export const userMessage = (text: string): SDKUserMessage => ({
  type: "user",
  message: { role: "user", content: text },
  parent_tool_use_id: null,
});
