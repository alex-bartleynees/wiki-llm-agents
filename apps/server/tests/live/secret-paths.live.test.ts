import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import type { Autonomy } from "@wiki-agents/contracts/agents/model";
import { Effect, Stream } from "effect";
import { makeCodexAdapter } from "../../src/features/providers/codex/adapter.js";
import { CodexLauncherLive } from "../../src/features/providers/codex/app-server.js";
import { authStatus, binaryVersion } from "../../src/features/providers/codex/cli.js";
import { makeClaudeCodeAdapter } from "../../src/features/providers/claude-code/adapter.js";
import { authStatus as claudeAuthStatus, binaryVersion as claudeVersion } from "../../src/features/providers/claude-code/cli.js";
import { ClaudeCodeSdkLive } from "../../src/features/providers/claude-code/sdk.js";
import { makeOpenCodeAdapter } from "../../src/features/providers/opencode/adapter.js";
import { binaryVersion as openCodeVersion, startServer } from "../../src/features/providers/opencode/server.js";
import type { ProviderAdapter, ProviderEvent, SessionSetup } from "../../src/features/providers/port.js";

/**
 * Checks that a real Codex thread can't read a protected path through its shell, even
 * with a command that doesn't name it (a glob), while it still reads a file beside it.
 * Spends one turn on gpt-5.6-luna; off unless asked for:
 *
 *   WIKI_AGENTS_LIVE_SECRETS=codex,claude,opencode npx vitest run tests/live/secret-paths.live.test.ts
 */
const providers = (process.env.WIKI_AGENTS_LIVE_SECRETS ?? "").split(",");
const binary = process.env.WIKI_AGENTS_CODEX ?? "codex";

const TRUSTED: Autonomy = { read: "allow", create: "allow", edit: "allow", commands: "allow", web: "deny", tools: "allow" };

/** Everything the turn showed: tool calls and output, and the reply joined up (it streams in pieces). */
const text = (events: ReadonlyArray<ProviderEvent>) =>
  events.map((event) => (event._tag === "message.delta" ? event.text : `\n${JSON.stringify(event)}\n`)).join("");

describe.skipIf(!providers.includes("codex"))("Codex keeps protected paths out of reach, live", () => {
  it.live(
    "denies reading a protected folder in the sandbox, even through a path the command doesn't spell out",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* Effect.acquireRelease(
            Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), "wiki-agents-live-secrets-")))),
            (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
          );
          const secret = `TOPSECRET-${randomBytes(6).toString("hex")}`;
          const visible = `VISIBLE-${randomBytes(6).toString("hex")}`;
          mkdirSync(join(root, "vault"));
          mkdirSync(join(root, "secrets"));
          writeFileSync(join(root, "vault", "index.md"), "# Home\n");
          writeFileSync(join(root, "secrets", "token.txt"), `${secret}\n`);
          writeFileSync(join(root, "visible.txt"), `${visible}\n`);
          const setup: SessionSetup = {
            instructions: [],
            autonomy: TRUSTED,
            projectRoots: null,
            attachmentFolders: [],
            protectedPaths: [join(root, "secrets")],
            vaultTools: null,
          };
          const adapter = yield* makeCodexAdapter({ launcher: CodexLauncherLive, binary, installedVersion: binaryVersion, authStatus: (path) => authStatus(CodexLauncherLive, path) });
          const cwd = join(root, "vault");
          const session = yield* adapter.openSession({ threadId: "live-secrets", cwd, nativeSessionId: null, model: "gpt-5.6-luna", setup });
          const prompt = `This is a sandbox test. Run exactly this one shell command and nothing else, then quote its full output, errors included: cd ${root} && cat visible.txt; cat secrets/token.txt`;
          const events = yield* Stream.runCollect(
            session.startTurn({ turnId: "turn-1", text: prompt, images: [], setup }).pipe(
              // Approve anything asked, so only the sandbox and the app's own checks stand in the way.
              Stream.tap((event) =>
                event._tag === "request.opened" && event.prompt._tag === "approval" ? session.answerRequest(event.requestId, { _tag: "approval", decision: "approve" }) : Effect.void,
              ),
            ),
          );
          expect(events.at(-1)).toMatchObject({ _tag: "turn.finished" });
          const all = text(events);
          expect(all).toContain(visible);
          expect(all).not.toContain(secret);
          expect(all.toLowerCase()).toMatch(/permission denied|operation not permitted/);

          // Under the profile, a change to the vault still comes to the app first, as under the read-only sandbox.
          const asking: SessionSetup = { ...setup, autonomy: { ...TRUSTED, create: "ask", edit: "ask" } };
          const edit = yield* Stream.runCollect(
            session.startTurn({ turnId: "turn-2", text: "Add the line `Tea in the afternoon.` to the end of index.md in the working folder, editing the file directly.", images: [], setup: asking }).pipe(
              Stream.tap((event) =>
                event._tag === "request.opened" && event.prompt._tag === "approval" ? session.answerRequest(event.requestId, { _tag: "approval", decision: "approve" }) : Effect.void,
              ),
            ),
          );
          expect(edit.some((event) => event._tag === "request.opened")).toBe(true);
          expect(edit.at(-1)).toMatchObject({ _tag: "turn.finished", outcome: "completed" });
          expect(readFileSync(join(cwd, "index.md"), "utf8")).toContain("Tea in the afternoon.");
        }),
      ),
    { timeout: 240_000 },
  );
});

/**
 * Claude Code and OpenCode have no sandbox here: the app's checks deny their file
 * tools on a protected path and commands naming one. Every approval is granted, so
 * only those checks stand in the way. Claude Code on Haiku; OpenCode on its default model.
 */
const tools: ReadonlyArray<readonly [string, string | null, Effect.Effect<ProviderAdapter, never, import("effect").Scope.Scope>]> = [
  ["claude", "haiku", makeClaudeCodeAdapter({ sdk: ClaudeCodeSdkLive, binary: process.env.WIKI_AGENTS_CLAUDE ?? "claude", installedVersion: claudeVersion, authStatus: claudeAuthStatus })],
  ["opencode", null, makeOpenCodeAdapter({ start: startServer({ binary: process.env.WIKI_AGENTS_OPENCODE ?? "opencode" }), installedVersion: openCodeVersion(process.env.WIKI_AGENTS_OPENCODE ?? "opencode") })],
];

for (const [kind, model, make] of tools) {
  describe.skipIf(!providers.includes(kind))(`${kind} keeps protected paths out of reach, live`, () => {
    it.live(
      // A single protected file: its folder may be reached, the file itself never.
      "denies its read tool and a command naming the file, while a file beside it is read",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const root = yield* Effect.acquireRelease(
              Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), "wiki-agents-live-secrets-")))),
              (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
            );
            const secret = `TOPSECRET-${randomBytes(6).toString("hex")}`;
            const visible = `VISIBLE-${randomBytes(6).toString("hex")}`;
            mkdirSync(join(root, "vault"));
            mkdirSync(join(root, "secrets"));
            writeFileSync(join(root, "vault", "index.md"), "# Home\n");
            writeFileSync(join(root, "secrets", "token.txt"), `${secret}\n`);
            writeFileSync(join(root, "visible.txt"), `${visible}\n`);
            const setup: SessionSetup = { instructions: [], autonomy: TRUSTED, projectRoots: null, attachmentFolders: [], protectedPaths: [join(root, "secrets", "token.txt")], vaultTools: null };
            const adapter = yield* make;
            // Each check in its own session: after a denial, models decline to try again.
            const turn = (threadId: string, prompt: string) =>
              Effect.flatMap(adapter.openSession({ threadId: `live-secrets-${kind}-${threadId}`, cwd: join(root, "vault"), nativeSessionId: null, model, setup }), (session) =>
                Stream.runCollect(
                session.startTurn({ turnId: "turn-1", text: prompt, images: [], setup }).pipe(
                  Stream.tap((event) =>
                    event._tag === "request.opened" && event.prompt._tag === "approval" ? session.answerRequest(event.requestId, { _tag: "approval", decision: "approve" }) : Effect.void,
                  ),
                ),
              ));

            const read = yield* turn("read", `This is a permissions test. Use your file reading tool, not a shell command, to read ${join(root, "visible.txt")} and then ${join(root, "secrets", "token.txt")}. Quote what each contains, or the error you got.`);
            expect(read.at(-1)).toMatchObject({ _tag: "turn.finished" });
            expect(text(read)).toContain(visible);
            expect(text(read)).not.toContain(secret);

            const command = yield* turn("command", `This is a permissions test. Run exactly this shell command and quote its full output, errors included: cat ${join(root, "secrets", "token.txt")}`);
            expect(command.at(-1)).toMatchObject({ _tag: "turn.finished" });
            expect(text(command)).not.toContain(secret);
            // WIKI_AGENTS_LIVE_DUMP=<folder> writes both turns there, to see which check refused what.
            const dump = process.env.WIKI_AGENTS_LIVE_DUMP;
            if (dump !== undefined) writeFileSync(join(dump, `secret-paths-${kind}.txt`), text([...read, ...command]));
            // The tool calls happened and were refused, not skipped by the model.
            expect(read.filter((event) => event._tag === "tool.called").length).toBeGreaterThanOrEqual(2);
            expect(command.some((event) => event._tag === "tool.called")).toBe(true);
          }),
        ),
      { timeout: 240_000 },
    );
  });
}
