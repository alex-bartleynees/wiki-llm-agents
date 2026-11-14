import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import type { Autonomy } from "@wiki-agents/contracts/agents/model";
import { Effect, Fiber, Stream } from "effect";
import { makeClaudeCodeAdapter } from "../../src/features/providers/claude-code/adapter.js";
import * as claudeCli from "../../src/features/providers/claude-code/cli.js";
import { ClaudeCodeSdkLive } from "../../src/features/providers/claude-code/sdk.js";
import { makeCodexAdapter } from "../../src/features/providers/codex/adapter.js";
import { CodexLauncherLive } from "../../src/features/providers/codex/app-server.js";
import * as codexCli from "../../src/features/providers/codex/cli.js";
import { makeOpenCodeAdapter } from "../../src/features/providers/opencode/adapter.js";
import { binaryVersion as openCodeVersion, startServer } from "../../src/features/providers/opencode/server.js";
import type { ProviderAdapter, ProviderEvent, SessionSetup } from "../../src/features/providers/port.js";

/**
 * After you press Stop and send a correction, does the next turn know what the
 * stopped turn did? Starts a slow task (write a file, `sleep`, write two more), stops
 * it during the `sleep`, then asks in the same session what happened. Off unless
 * asked for; each provider has its own switch (they spend a little of your plan):
 *
 *   WIKI_AGENTS_LIVE_STOP=opencode,claude,codex npx vitest run tests/live/stop-context.live.test.ts
 */
const wanted = new Set((process.env.WIKI_AGENTS_LIVE_STOP ?? "").split(",").filter(Boolean));

const AUTONOMY: Autonomy = { read: "allow", create: "allow", edit: "allow", commands: "allow", web: "deny" };
const SETUP: SessionSetup = { instructions: [], autonomy: AUTONOMY, projectRoots: null, vaultTools: null };

const TASK = [
  "Do these steps in order, one tool call per step, without asking me anything:",
  "1. Create the file step-1.md containing the word one.",
  "2. Run the shell command `sleep 60`.",
  "3. Create the file step-2.md containing the word two.",
  "4. Create the file step-3.md containing the word three.",
].join("\n");

const QUESTION =
  "I stopped your previous turn. Without using any tools, answer from memory: which files did you create in it, and which step were you on when I stopped you? Answer in two short lines.";

interface Case {
  readonly name: string;
  readonly model: string | null;
  readonly adapter: Effect.Effect<ProviderAdapter, unknown, never>;
}

const CASES: ReadonlyArray<Case> = [
  {
    name: "opencode",
    model: null,
    adapter: makeOpenCodeAdapter({ start: startServer({ binary: "opencode" }), installedVersion: openCodeVersion("opencode") }) as never,
  },
  {
    name: "claude",
    model: "haiku",
    adapter: makeClaudeCodeAdapter({ sdk: ClaudeCodeSdkLive, binary: "claude", installedVersion: claudeCli.binaryVersion, authStatus: claudeCli.authStatus }) as never,
  },
  {
    name: "codex",
    model: "gpt-5.6-luna",
    adapter: makeCodexAdapter({
      launcher: CodexLauncherLive,
      binary: "codex",
      installedVersion: codexCli.binaryVersion,
      authStatus: (path) => codexCli.authStatus(CodexLauncherLive, path),
    }) as never,
  },
];

const text = (events: ReadonlyArray<ProviderEvent>) => events.flatMap((event) => (event._tag === "message.delta" ? [event.text] : [])).join("");

describe("Stop keeps context, live", () => {
  for (const testCase of CASES) {
    it.live.skipIf(!wanted.has(testCase.name))(
      testCase.name,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const root = yield* Effect.acquireRelease(
              Effect.sync(() => mkdtempSync(join(tmpdir(), "wiki-agents-stop-"))),
              (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
            );
            const adapter = yield* testCase.adapter;
            const session = yield* adapter.openSession({ threadId: "live-stop", cwd: root, nativeSessionId: null, model: testCase.model, setup: SETUP });

            // Turn 1: stop it once the agent starts the sleep (as the app does: ask the provider, stop reading).
            const first: Array<ProviderEvent> = [];
            const reading = yield* Stream.runForEach(session.startTurn({ turnId: "turn-1", text: TASK, setup: SETUP }), (event) =>
              Effect.sync(() => first.push(event)),
            ).pipe(Effect.forkChild);
            const sawSleep = () => first.some((event) => event._tag === "tool.called" && event.input.includes("sleep"));
            const deadline = Date.now() + 150_000;
            while (!sawSleep() && Date.now() < deadline) yield* Effect.sleep("500 millis");
            yield* Effect.sleep("2 seconds");
            yield* session.interrupt("turn-1");
            yield* Fiber.interrupt(reading);

            const files = { step1: existsSync(join(root, "step-1.md")), step2: existsSync(join(root, "step-2.md")) };
            console.log(`[${testCase.name}] turn 1 tools:`, first.filter((event) => event._tag === "tool.called").map((event) => `${event.name} ${event.input.slice(0, 80)}`));
            console.log(`[${testCase.name}] turn 1 files:`, files);
            expect(sawSleep()).toBe(true);

            // Turn 2, same session: what does the agent remember?
            const second: ReadonlyArray<ProviderEvent> = yield* Stream.runCollect(session.startTurn({ turnId: "turn-2", text: QUESTION, setup: SETUP }));
            const reply = text(second);
            console.log(`[${testCase.name}] turn 2 finished:`, second.at(-1));
            console.log(`[${testCase.name}] turn 2 reply:\n${reply}`);
            expect(reply).toMatch(/step-1/);
          }),
        ),
      { timeout: 300_000 },
    );
  }
});
