import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import type { Autonomy } from "@wiki-agents/contracts/agents/model";
import { Effect, Stream } from "effect";
import { makeClaudeCodeAdapter } from "../../src/features/providers/claude-code/adapter.js";
import * as claudeCli from "../../src/features/providers/claude-code/cli.js";
import { ClaudeCodeSdkLive } from "../../src/features/providers/claude-code/sdk.js";
import { makeCodexAdapter } from "../../src/features/providers/codex/adapter.js";
import { CodexLauncherLive } from "../../src/features/providers/codex/app-server.js";
import * as codexCli from "../../src/features/providers/codex/cli.js";
import { makeOpenCodeAdapter } from "../../src/features/providers/opencode/adapter.js";
import { binaryVersion as openCodeVersion, startServer } from "../../src/features/providers/opencode/server.js";
import type { ProviderAdapter, ProviderEvent, ProviderSession, SessionSetup } from "../../src/features/providers/port.js";

/**
 * Two questions for the MCP gateway (slice 15c), asked of each real provider with a
 * stand-in MCP server registered as the thread's `wiki-agents-<thread id>` entry:
 *
 * 1. Tool names: can the agent call `<server>__<tool>` names of 60 and 100 characters?
 * 2. A tool list that changes between turns (switching agents): does the next turn
 *    see a tool added on the server, with the entry unchanged? If not, does it after
 *    the adapter registers the entry again (a new token, as on token renewal)?
 *
 * The answers are read from what the stand-in server was asked, not from the model's
 * words. Off unless asked for; each provider spends a little of your plan:
 *
 *   WIKI_AGENTS_LIVE_TOOLS=opencode,claude,codex npx vitest run tests/live/mcp-tool-list.live.test.ts --disable-console-intercept
 *
 * Found 2026-11-17 (Claude Code 2.1.322 on Haiku, Codex 0.167.1, OpenCode 2.2.6):
 * - No provider asks for the list again while the entry is unchanged.
 * - Registering again with a new token is enough for Claude Code and Codex. OpenCode
 *   connects again and fetches the list but keeps offering the old tools; it needs a
 *   new entry name too (`WIKI_AGENTS_LIVE_TOOLS_RENAME=1`).
 * - Claude Code silently drops the 100-character name (155 with its
 *   `mcp__wiki-agents-<uuid>__` prefix) and takes the 60-character one (115). Codex and
 *   OpenCode call both.
 */
const wanted = new Set((process.env.WIKI_AGENTS_LIVE_TOOLS ?? "").split(",").filter(Boolean));

const pad = (name: string, length: number) => name + "x".repeat(length - name.length);
const ALPHA = "alpha_ping";
const BETA = "beta_ping";
const LONG_60 = pad("github__create_pull_request_review_comment_", 60);
const LONG_100 = pad("github__create_or_update_pull_request_review_comment_reply_", 100);

interface Seen {
  readonly method: string;
  readonly tool?: string;
}

/** A minimal MCP server over HTTP (JSON answers, no sessions): the tools named in `tools`, each answering `<name> ok`. */
const startFakeMcp = (state: { tools: ReadonlyArray<string>; readonly seen: Array<Seen> }) =>
  Effect.acquireRelease(
    Effect.callback<Server>((resume) => {
      const answer = (message: { readonly id?: unknown; readonly method?: string; readonly params?: Record<string, unknown> }) => {
        const method = message.method ?? "";
        const params = message.params ?? {};
        state.seen.push({ method, ...(method === "tools/call" ? { tool: String(params.name) } : {}) });
        if (message.id === undefined) return undefined;
        const result = (value: unknown) => ({ jsonrpc: "2.0", id: message.id, result: value });
        switch (method) {
          case "initialize":
            return result({
              protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: "fake", version: "1" },
            });
          case "ping":
            return result({});
          case "tools/list":
            return result({
              tools: state.tools.map((name) => ({ name, description: `Answers "${name} ok". Takes no arguments.`, inputSchema: { type: "object", properties: {} } })),
            });
          case "tools/call":
            return state.tools.includes(String(params.name))
              ? result({ content: [{ type: "text", text: `${String(params.name)} ok` }] })
              : { jsonrpc: "2.0", id: message.id, error: { code: -32602, message: `Unknown tool: ${String(params.name)}` } };
          default:
            return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } };
        }
      };
      const server = createServer((request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405).end();
          return;
        }
        const chunks: Array<Buffer> = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const answers = (Array.isArray(body) ? body : [body]).map(answer).filter((value) => value !== undefined);
          if (answers.length === 0) {
            response.writeHead(202).end();
            return;
          }
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(Array.isArray(body) ? answers : answers[0]));
        });
      });
      server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)));
    }),
    (server) => Effect.sync(() => void server.closeAllConnections()).pipe(Effect.andThen(Effect.promise(() => new Promise((done) => server.close(done))))),
  );

const AUTONOMY: Autonomy = { read: "allow", create: "deny", edit: "deny", commands: "deny", web: "deny" };

interface Case {
  readonly name: string;
  readonly model: string | null;
  readonly adapter: Effect.Effect<ProviderAdapter, unknown, never>;
}

const CASES: ReadonlyArray<Case> = [
  {
    name: "opencode",
    model: process.env.WIKI_AGENTS_LIVE_TOOLS_OPENCODE_MODEL ?? null,
    adapter: makeOpenCodeAdapter({ start: startServer({ binary: "opencode" }), installedVersion: openCodeVersion("opencode") }) as never,
  },
  {
    name: "claude",
    model: "haiku",
    adapter: makeClaudeCodeAdapter({ sdk: ClaudeCodeSdkLive, binary: "claude", installedVersion: claudeCli.binaryVersion, authStatus: claudeCli.authStatus }) as never,
  },
  {
    name: "codex",
    model: process.env.WIKI_AGENTS_LIVE_TOOLS_CODEX_MODEL ?? null,
    adapter: makeCodexAdapter({
      launcher: CodexLauncherLive,
      binary: "codex",
      installedVersion: codexCli.binaryVersion,
      authStatus: (path) => codexCli.authStatus(CodexLauncherLive, path),
    }) as never,
  },
];

/** Runs a turn to its end, approving anything it asks; its events. */
const runTurn = (session: ProviderSession, turnId: string, text: string, setup: SessionSetup) =>
  Effect.gen(function* () {
    const events: Array<ProviderEvent> = [];
    yield* Stream.runForEach(session.startTurn({ turnId, text, images: [], setup }), (event) =>
      Effect.gen(function* () {
        events.push(event);
        if (event._tag === "request.opened") yield* session.answerRequest(event.requestId, { _tag: "approval", decision: "approve" });
      }),
    );
    return events;
  });

const summary = (events: ReadonlyArray<ProviderEvent>) => ({
  tools: events.flatMap((event) => (event._tag === "tool.called" ? [event.name] : [])),
  notices: events.flatMap((event) => (event._tag === "notice" ? [event.text] : [])),
  reply: events.flatMap((event) => (event._tag === "message.delta" ? [event.text] : [])).join("").slice(0, 600),
  finished: events.at(-1),
});

const callsOf = (seen: ReadonlyArray<Seen>) => seen.flatMap((entry) => (entry.method === "tools/call" && entry.tool !== undefined ? [entry.tool] : []));
const count = (seen: ReadonlyArray<Seen>, method: string) => seen.filter((entry) => entry.method === method).length;

describe("MCP tool names and a changing tool list, live", () => {
  for (const testCase of CASES) {
    it.live.skipIf(!wanted.has(testCase.name))(
      testCase.name,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const root = yield* Effect.acquireRelease(
              Effect.sync(() => mkdtempSync(join(tmpdir(), "wiki-agents-tools-"))),
              (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
            );
            const state = { tools: [ALPHA, LONG_60, LONG_100] as ReadonlyArray<string>, seen: [] as Array<Seen> };
            const server = yield* startFakeMcp(state);
            const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
            // The same shape as a real thread's entry: `wiki-agents-<uuid>`.
            const entry = { name: "wiki-agents-32ab342f-eeb9-4dc7-87b3-4fdb6b4ce648", url };
            const setup = (token: string, name = entry.name): SessionSetup => ({
              instructions: [],
              autonomy: AUTONOMY,
              projectRoots: null,
              attachmentFolders: [],
              vaultTools: { ...entry, name, token },
            });
            const log = (label: string, value: unknown) => console.log(`[${testCase.name}] ${label}:`, JSON.stringify(value));

            const adapter = yield* testCase.adapter;
            const session = yield* adapter.openSession({ threadId: "live-tools", cwd: root, nativeSessionId: null, model: testCase.model, setup: setup("token-1") });

            // Turn 1: names.
            const names = yield* runTurn(
              session,
              "turn-1",
              `You have MCP tools from a server whose name starts with "wiki-agents". Call each of these three once, with no arguments, then reply with one line per tool saying whether it worked: ${ALPHA}, ${LONG_60}, ${LONG_100}. If a tool is missing from your tools, say MISSING for it. Don't use any other tool.`,
              setup("token-1"),
            );
            log("turn 1", summary(names));
            log("turn 1 server saw calls", callsOf(state.seen));
            log("turn 1 server saw tools/list", count(state.seen, "tools/list"));

            // The list changes on the server; the entry is the same.
            state.tools = [...state.tools, BETA];
            const before = state.seen.length;
            const ask = `Call the MCP tool ${BETA} from the same server once, with no arguments, and reply with its result. If you have no such tool, reply exactly NO BETA TOOL. Don't use any other tool.`;
            // Left out with WIKI_AGENTS_LIVE_TOOLS_SKIP_SAME=1, so turn 3 has no earlier "NO BETA TOOL" answer to copy.
            const same = process.env.WIKI_AGENTS_LIVE_TOOLS_SKIP_SAME === "1" ? [] : yield* runTurn(session, "turn-2", ask, setup("token-1"));
            const afterSame = state.seen.slice(before);
            log("turn 2 (same entry)", summary(same));
            log("turn 2 server saw", { list: count(afterSame, "tools/list"), calls: callsOf(afterSame) });

            // The adapter registers the entry again (a new token, as on renewal).
            const beforeAgain = state.seen.length;
            // With WIKI_AGENTS_LIVE_TOOLS_RENAME=1 the entry also gets a new name.
            const renamed = process.env.WIKI_AGENTS_LIVE_TOOLS_RENAME === "1" ? `${entry.name}-2` : entry.name;
            const again = yield* runTurn(session, "turn-3", ask, setup("token-2", renamed));
            const afterAgain = state.seen.slice(beforeAgain);
            log("turn 3 (registered again)", summary(again));
            log("turn 3 server saw", { list: count(afterAgain, "tools/list"), initialize: count(afterAgain, "initialize"), calls: callsOf(afterAgain) });

            log("result", {
              alpha: callsOf(state.seen).includes(ALPHA),
              long60: callsOf(state.seen).includes(LONG_60),
              long100: callsOf(state.seen).includes(LONG_100),
              betaWithSameEntry: callsOf(afterSame).includes(BETA),
              betaAfterRegisteringAgain: callsOf(afterAgain).includes(BETA),
            });
            expect(callsOf(state.seen)).toContain(ALPHA);
          }),
        ),
      { timeout: 600_000 },
    );
  }
});
