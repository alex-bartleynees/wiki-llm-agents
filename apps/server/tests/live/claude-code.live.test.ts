import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_AUTONOMY } from "@wiki-agents/contracts/agents/model";
import { Effect, Stream } from "effect";
import { makeClaudeCodeAdapter } from "../../src/features/providers/claude-code/adapter.js";
import { authStatus, binaryVersion } from "../../src/features/providers/claude-code/cli.js";
import { ClaudeCodeSdkLive } from "../../src/features/providers/claude-code/sdk.js";
import type { SessionSetup } from "../../src/features/providers/port.js";
import { VAULT_FILES } from "../fixtures/claude-code/fixture.js";

/**
 * Runs one real turn on the installed Claude Code, on Haiku, in a temp copy of the
 * fixtures' vault. Off unless asked for, as it needs Claude Code, a login, and the
 * network, and spends a little of your plan or credit:
 *
 *   WIKI_AGENTS_LIVE_CLAUDE=1 npx vitest run tests/live/claude-code.live.test.ts
 */
const live = process.env.WIKI_AGENTS_LIVE_CLAUDE === "1";
const binary = process.env.WIKI_AGENTS_CLAUDE ?? "claude";

/** An agent instruction the answer can only follow if it reached the model. */
const SETUP: SessionSetup = {
  instructions: [
    { source: "agent", title: "Test agent", path: "/nowhere/agents/test.md", text: "End every answer with the word PINEAPPLE, in capitals." },
  ],
  autonomy: DEFAULT_AUTONOMY,
  projectRoots: null,
  vaultTools: null,
};

describe.skipIf(!live)("Claude Code, live", () => {
  it.live(
    "answers a question about the vault, following the agent's instructions",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* Effect.acquireRelease(
            Effect.sync(() => mkdtempSync(join(tmpdir(), "wiki-agents-live-"))),
            (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
          );
          for (const [path, content] of Object.entries(VAULT_FILES)) {
            mkdirSync(dirname(join(root, path)), { recursive: true });
            writeFileSync(join(root, path), content);
          }
          const adapter = yield* makeClaudeCodeAdapter({ sdk: ClaudeCodeSdkLive, binary, installedVersion: binaryVersion, authStatus });
          expect(yield* adapter.status).toMatchObject({ _tag: "ready" });
          expect((yield* adapter.listModels(root)).models.length).toBeGreaterThan(0);

          const session = yield* adapter.openSession({ threadId: "live", cwd: root, nativeSessionId: null, model: "haiku", setup: SETUP });
          // Reading needs no approval; anything else is denied, and the agent carries on.
          const events = yield* Stream.runCollect(
            session
              .startTurn({ turnId: "turn-1", text: "What do I like to drink in the afternoon? Read the notes; answer in one sentence.", images: [], setup: SETUP })
              .pipe(
                Stream.tap((event) =>
                  event._tag === "request.opened" && event.prompt._tag === "approval"
                    ? session.answerRequest(event.requestId, { _tag: "approval", decision: "deny" })
                    : Effect.void,
                ),
              ),
          );
          const asked = events.flatMap((event) => (event._tag === "request.opened" && event.prompt._tag === "approval" ? [event.prompt.title] : []));
          for (const title of asked) expect(title).not.toMatch(/^Read /);
          expect(events.at(-1)).toMatchObject({ _tag: "turn.finished", outcome: "completed" });
          const reply = events.flatMap((event) => (event._tag === "message.delta" ? [event.text] : [])).join("");
          expect(reply.toLowerCase()).toContain("tea");
          expect(reply).toContain("PINEAPPLE");
        }),
      ),
    { timeout: 180_000 },
  );
});
