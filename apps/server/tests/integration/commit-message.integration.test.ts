import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, layer } from "@effect/vitest";
import { afterAll, beforeEach } from "vitest";
import { GetCommitMessageSettingsResponse } from "@wiki-agents/contracts/projects/get-commit-message-settings/response";
import { RegisterProjectResponse } from "@wiki-agents/contracts/projects/register-project/response";
import { SaveCommitMessageSettingsResponse } from "@wiki-agents/contracts/projects/save-commit-message-settings/response";
import { SuggestCommitMessageResponse } from "@wiki-agents/contracts/projects/suggest-commit-message/response";
import { Effect, Stream } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import type { OpenSessionInput, ProviderAdapter, ProviderEvent } from "../../src/features/providers/port.js";
import { makeProviderRegistry } from "../../src/features/providers/registry-live.js";
import { ReplayAdapter } from "../../src/features/providers/replay/adapter.js";
import { makeTestApp } from "./infrastructure/test-app.js";
import { decode, post } from "./infrastructure/threads.js";

/**
 * A provider without its own one-shot call, so suggestions go through a throwaway
 * session: it keeps what it was given and answers with `answer`, or asks for
 * something when `answer` is null.
 */
const sessions: Array<{ readonly input: OpenSessionInput; readonly prompts: Array<string>; closed: boolean }> = [];
let answer: string | null = "```\nBump a\n\nBecause.\n```";
const echo: ProviderAdapter = {
  kind: "echo",
  capabilities: { interrupt: true, resume: false, approvals: true, questions: false, models: true, images: false },
  openSession: (input) =>
    Effect.gen(function* () {
      const record = { input, prompts: [] as Array<string>, closed: false };
      sessions.push(record);
      yield* Effect.addFinalizer(() => Effect.sync(() => (record.closed = true)));
      return {
        nativeSessionId: null,
        startTurn: ({ turnId, text }) => {
          record.prompts.push(text);
          const events: Array<ProviderEvent> =
            answer === null
              ? [{ _tag: "request.opened", turnId, requestId: "r1", prompt: { _tag: "approval", title: "Run git log", detail: "git log" } }]
              : [
                  { _tag: "message.delta", turnId, messageId: "thinking", text: "Let me look." },
                  { _tag: "message.delta", turnId, messageId: "answer", text: answer.slice(0, 5) },
                  { _tag: "message.delta", turnId, messageId: "answer", text: answer.slice(5) },
                  { _tag: "turn.finished", turnId, outcome: "completed", usage: { inputTokens: 900, outputTokens: 20, costUsd: 0.0012 }, reason: null },
                ];
          return Stream.fromIterable(events);
        },
        resumeTurn: () => Effect.succeedNone,
        interrupt: () => Effect.void,
        answerRequest: () => Effect.void,
        setModel: () => Effect.void,
      };
    }),
  enforcement: () => ({ autonomy: null, notes: [] }),
  status: Effect.succeed({ _tag: "ready", version: null, account: null }),
  listModels: () => Effect.succeed({ models: [], defaultModel: null }),
};
beforeEach(() => {
  answer = "```\nBump a\n\nBecause.\n```";
});

const sharedRoot = realpathSync(mkdtempSync(join(tmpdir(), "wiki-message-vault-")));
writeFileSync(join(sharedRoot, "index.md"), "# Shared");
afterAll(() => rmSync(sharedRoot, { recursive: true, force: true }));

const temp = Effect.acquireRelease(
  Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), "wiki-message-")))),
  (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
);

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });

/** A repository with two commits, then a change to `app.ts` and `other.ts` and a new `new.ts`. */
const changedRepository = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "app.ts"), "const a = 1;\n");
  writeFileSync(join(dir, "other.ts"), "secret = 1\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "Add the app");
  writeFileSync(join(dir, "app.ts"), "const a = 1;\nconst b = 1;\n");
  git(dir, "commit", "-qam", "feat: add b");
  writeFileSync(join(dir, "app.ts"), "const a = 2;\nconst b = 1;\n");
  writeFileSync(join(dir, "other.ts"), "secret = 2\n");
  writeFileSync(join(dir, "new.ts"), "export const c = 3;\n");
  return dir;
};

const register = (workingDirectories: ReadonlyArray<string>) =>
  post("/api/projects", { name: "Messages", workingDirectories }).pipe(Effect.flatMap(decode(RegisterProjectResponse)), Effect.map((result) => result.project));
const suggest = (projectId: string, body: unknown) => post(`/api/projects/${projectId}/git/suggest-message`, body);
const suggestOk = (projectId: string, body: unknown) => suggest(projectId, body).pipe(Effect.flatMap(decode(SuggestCommitMessageResponse)));
const settings = HttpClient.get("/api/commit-messages/settings").pipe(Effect.flatMap(decode(GetCommitMessageSettingsResponse)));
const save = (body: unknown) => HttpClientRequest.put("/api/commit-messages/settings").pipe(HttpClientRequest.bodyJsonUnsafe(body), HttpClient.execute);
const saveOk = (body: unknown) => save(body).pipe(Effect.flatMap(decode(SaveCommitMessageSettingsResponse)));

layer(makeTestApp({ vaults: [sharedRoot], providers: makeProviderRegistry(Effect.succeed([echo, ReplayAdapter])) }))("suggest a commit message", (test) => {
  test.effect("sends only the ticked files' diffs and the recent subjects, in a session that can do nothing, and cleans the answer", () =>
    Effect.gen(function* () {
      const repo = changedRepository(join(yield* temp, "repo"));
      const project = yield* register([repo]);
      // Nothing chosen and no Claude Code: the first provider, its default model.
      expect(yield* settings).toEqual({ settings: { providerInstanceId: null, model: null }, effective: { providerInstanceId: "echo", providerName: "echo", model: null } });

      const result = yield* suggestOk(project.id, { directory: repo, paths: ["app.ts", "new.ts"] });
      expect(result).toEqual({
        message: "Bump a\n\nBecause.",
        provider: { providerInstanceId: "echo", providerName: "echo", model: null },
        usage: { inputTokens: 900, outputTokens: 20, costUsd: 0.0012 },
        truncated: false,
      });

      const session = sessions.at(-1)!;
      expect(session.closed).toBe(true);
      expect(session.input.cwd).toBe(repo);
      expect(session.input.setup).toMatchObject({
        autonomy: { read: "deny", create: "deny", edit: "deny", commands: "deny", web: "deny" },
        vaultTools: null,
        attachmentFolders: [],
        protectedPaths: [],
      });
      expect(session.input.setup.instructions.map((instruction) => instruction.text).join("\n")).toContain("commit messages");
      const prompt = session.prompts[0]!;
      expect(prompt).toContain("Files to commit (2):\n- modified app.ts\n- untracked new.ts\n");
      expect(prompt).toContain("* feat: add b\n* Add the app\n");
      expect(prompt).toContain("-const a = 1;\n+const a = 2;");
      expect(prompt).toContain("+export const c = 3;");
      // The unticked file never leaves the machine.
      expect(prompt).not.toContain("other.ts");
      expect(prompt).not.toContain("secret");
      // Nothing was committed or staged.
      expect(git(repo, "rev-list", "--count", "HEAD").trim()).toBe("2");
      expect(git(repo, "diff", "--cached", "--name-only")).toBe("");
    }));

  test.effect("uses the chosen provider and model, and refuses an unknown one", () =>
    Effect.gen(function* () {
      const repo = changedRepository(join(yield* temp, "repo"));
      const project = yield* register([repo]);
      expect(yield* saveOk({ providerInstanceId: "replay", model: "  " })).toEqual({
        settings: { providerInstanceId: "replay", model: null },
        effective: { providerInstanceId: "replay", providerName: "Replay (recorded, free)", model: null },
      });
      const result = yield* suggestOk(project.id, { directory: repo, paths: ["app.ts"] });
      expect(result.message).toBe("Replay suggestion for app.ts\n\nA recorded answer; no model was asked.");
      expect(result.provider.providerInstanceId).toBe("replay");
      expect(result.usage?.costUsd).toBe(0);

      expect((yield* saveOk({ providerInstanceId: "echo", model: "small" })).effective).toEqual({ providerInstanceId: "echo", providerName: "echo", model: "small" });
      yield* suggestOk(project.id, { directory: repo, paths: ["app.ts"] });
      expect(sessions.at(-1)!.input.model).toBe("small");

      const unknown = yield* save({ providerInstanceId: "missing", model: null });
      expect(unknown.status).toBe(400);
      // The default keeps no model of its own.
      expect((yield* saveOk({ providerInstanceId: null, model: "small" })).settings).toEqual({ providerInstanceId: null, model: null });
    }));

  test.effect("refuses bad requests, stale ticks, and a model that asks instead of answering", () =>
    Effect.gen(function* () {
      const dir = yield* temp;
      const repo = changedRepository(join(dir, "repo"));
      const project = yield* register([repo]);
      for (const [body, status, message] of [
        [{ directory: repo, paths: [] }, 400, "Tick at least one file"],
        [{ directory: repo, paths: ["../x"] }, 400, "Paths must be relative and inside the working directory"],
        [{ directory: dir, paths: ["app.ts"] }, 400, "Not one of the project's working directories in git, or a thread's worktree"],
        [{ directory: repo, paths: ["unchanged.ts"] }, 409, "None of the ticked files has changes now. Review the changes again."],
      ] as const) {
        const response = yield* suggest(project.id, body);
        expect([response.status, yield* response.text]).toEqual([status, message]);
      }
      answer = null;
      const asked = yield* suggest(project.id, { directory: repo, paths: ["app.ts"] });
      expect([asked.status, yield* asked.text]).toEqual([502, "The model asked for something instead of answering."]);
      answer = "   ";
      const empty = yield* suggest(project.id, { directory: repo, paths: ["app.ts"] });
      expect([empty.status, yield* empty.text]).toEqual([502, "The model gave an empty answer."]);
    }));
});
