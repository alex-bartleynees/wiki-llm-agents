import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, layer } from "@effect/vitest";
import { GetBrowserSignInsResponse } from "@wiki-agents/contracts/projects/get-browser-sign-ins/response";
import type { BrowserSignIn } from "@wiki-agents/contracts/projects/model";
import { SaveBrowserSignInsResponse } from "@wiki-agents/contracts/projects/save-browser-sign-ins/response";
import { CreateThreadResponse } from "@wiki-agents/contracts/threads/create-thread/response";
import { Effect, Fiber } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { afterAll } from "vitest";
import { McpPool, type McpScopeContext } from "../../src/features/mcp-servers/pool.js";
import { SecretStore } from "../../src/features/secrets/secret-store.js";
import { browserThreadInTurn, isToolRequest, registerProject, saveSignIns, setSecret, signInsPath } from "./infrastructure/browser-sign-ins.js";
import { mcpSession, tokenFor } from "./infrastructure/mcp.js";
import { makeTestApp } from "./infrastructure/test-app.js";
import { answer, decode, getThread, interrupt, post } from "./infrastructure/threads.js";

// The built-in browser, with the stdio stand-in in place of Playwright MCP: started with
// the built-in flags, it reads `--secrets` and types a secret for its name, as Playwright does.
const STDIO_SERVER = fileURLToPath(new URL("./infrastructure/stand-in-mcp-stdio.mjs", import.meta.url));
const work = realpathSync(mkdtempSync(join(tmpdir(), "wiki-agents-sign-ins-")));
afterAll(() => rmSync(work, { recursive: true, force: true }));
const command = join(work, "playwright-mcp");
writeFileSync(command, `#!/bin/sh\nexec "${process.execPath}" "${STDIO_SERVER}" "$@"\n`);
chmodSync(command, 0o755);
const browser = { command, stateDir: join(work, "browser"), blockedOrigins: [] };
const sharedRoot = join(work, "vault");
const appDir = join(work, "app");
for (const dir of [sharedRoot, appDir]) mkdirSync(dir, { recursive: true });
writeFileSync(join(sharedRoot, "index.md"), "# Shared");

const PASSWORD = "correct horse 'battery' staple";
const DEMO: BrowserSignIn = {
  name: "Demo local",
  origins: ["http://localhost:4200"],
  credentials: [
    { variable: "DEMO_USER", secret: "demo-user" },
    { variable: "DEMO_PASSWORD", secret: "demo-password" },
  ],
};

const register = (name: string) => registerProject(name, appDir);
const textOf = (result: { readonly content: ReadonlyArray<{ readonly text?: string }> } | Readonly<Record<string, unknown>>) =>
  ((result as { content: ReadonlyArray<{ readonly text?: string }> }).content[0]?.text ?? "") as string;
const runFiles = Effect.map(Effect.service(SecretStore), (store) => (existsSync(store.runDirectory) ? readdirSync(store.runDirectory) : []));

layer(makeTestApp({ browser, vaults: [sharedRoot] }))("browser sign-ins", (it) => {
  it.effect("are saved per project, checked, with sites kept as origins", () =>
    Effect.gen(function* () {
      const project = yield* register("Sign-ins");
      const get = HttpClient.get(signInsPath(project.id)).pipe(Effect.flatMap(decode(GetBrowserSignInsResponse)));
      expect((yield* get).signIns).toEqual([]);

      const refused = yield* saveSignIns(project.id, [
        { name: " ", origins: ["localhost:4200"], credentials: [{ variable: "pw", secret: "" }] },
        { name: "Other", origins: ["http://localhost:4300"], credentials: [{ variable: "OTHER_PASSWORD", secret: "other" }, { variable: "OTHER_PASSWORD", secret: "again" }] },
      ]);
      expect(refused.status).toBe(400);
      const problems = yield* refused.text;
      expect(problems).toContain("Sign-in 1: give it a name.");
      expect(problems).toContain('"localhost:4200" isn\'t an http:// or https:// address.');
      expect(problems).toContain('"pw" must be 4 to 64 capital letters');
      expect(problems).toContain("OTHER_PASSWORD is used twice");
      expect((yield* get).signIns).toEqual([]);

      const saved = yield* saveSignIns(project.id, [{ ...DEMO, name: " Demo local ", origins: ["http://localhost:4200/login", "http://localhost:4200"] }]).pipe(
        Effect.flatMap(decode(SaveBrowserSignInsResponse)),
      );
      expect(saved.signIns).toEqual([DEMO]);
      expect((yield* get).signIns).toEqual([DEMO]);
      expect((yield* saveSignIns("missing", [])).status).toBe(404);
    }),
  );

  it.effect("reach the browser as a secrets file it reads once as it starts; values never come back", () =>
    Effect.gen(function* () {
      yield* setSecret("demo-user", "tester@example.com");
      yield* setSecret("demo-password", PASSWORD);
      const pool = yield* McpPool;
      const context: McpScopeContext = { threadId: "pool-thread", projectId: "p", cwd: work, signIns: [DEMO] };
      const call = (tool: string, args: Record<string, unknown> = {}) => pool.callTool("playwright", context, tool, args);

      const args = textOf(yield* call("args")).split("\n");
      expect(args.slice(-2)[0]).toBe("--secrets");
      // Readable by the app's user only, and gone once the browser had started.
      expect(JSON.parse(textOf(yield* call("secrets_file")))).toEqual({ mode: "600", stillThere: false, names: ["DEMO_USER", "DEMO_PASSWORD"] });
      expect(yield* runFiles).toEqual([]);
      // The browser types the value for the name; a page echoing it is redacted.
      const typed = textOf(yield* call("browser_type", { ref: "e1", text: "DEMO_PASSWORD" }));
      expect(typed).toContain('Typed "[redacted]"');
      expect(typed).not.toContain("horse");

      // Without sign-ins, the same thread's browser starts again without the file.
      const plain = textOf(yield* pool.callTool("playwright", { ...context, signIns: [] }, "args", {}));
      expect(plain).not.toContain("--secrets");
    }),
  );

  it.effect("a missing secret keeps the browser from starting, saying which", () =>
    Effect.gen(function* () {
      const pool = yield* McpPool;
      const missing: BrowserSignIn = { ...DEMO, name: "Broken", credentials: [{ variable: "BROKEN_PASSWORD", secret: "not-stored" }] };
      const error = yield* Effect.flip(pool.callTool("playwright", { threadId: "broken", projectId: "p", cwd: work, signIns: [missing] }, "args", {}));
      expect(error._tag).toBe("McpServerUnavailable");
      expect("reason" in error ? error.reason : "").toContain('Browser sign-in "Broken", BROKEN_PASSWORD');
      expect(yield* runFiles).toEqual([]);
    }),
  );

  it.effect("are typed only on their sites and always after asking, even when the agent may use tools freely", () =>
    Effect.gen(function* () {
      yield* setSecret("demo-user", "tester@example.com");
      yield* setSecret("demo-password", PASSWORD);
      const project = yield* register("Typing");
      yield* saveSignIns(project.id, [DEMO]).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
      const { thread, events, mcp } = yield* browserThreadInTurn(project.id, project.vaultId, { tools: "allow" });

      // No page yet, then a page on another site: refused before the browser is asked.
      expect(textOf(yield* mcp.call("playwright__browser_type", { ref: "e1", text: "DEMO_PASSWORD" }))).toMatch(/hasn't reported a page yet/);
      yield* mcp.call("playwright__browser_navigate", { url: "https://evil.example/login" });
      const elsewhere = yield* mcp.call("playwright__browser_type", { ref: "e1", text: "DEMO_PASSWORD" });
      expect(elsewhere.isError).toBe(true);
      expect(textOf(elsewhere)).toContain("DEMO_PASSWORD may only be typed on http://localhost:4200");
      // Other text is typed as the agent's autonomy says: without asking.
      expect(textOf(yield* mcp.call("playwright__browser_type", { ref: "e1", text: "hello" }))).toContain('Typed "hello"');

      yield* mcp.call("playwright__browser_navigate", { url: "http://localhost:4200/login" });
      const typing = yield* Effect.forkChild(mcp.call("playwright__browser_type", { ref: "e2", text: "DEMO_PASSWORD" }));
      const opened = (yield* events.until(isToolRequest, "0 seconds")).find(isToolRequest);
      if (opened?._tag !== "request.opened" || opened.prompt._tag !== "approval") return yield* Effect.die("no approval was asked for");
      expect(opened.prompt.detail).toContain('Types DEMO_PASSWORD (sign-in "Demo local") on http://localhost:4200/login.');
      expect(opened.prompt.detail).not.toContain("horse");
      yield* answer(thread.id, opened.requestId, { _tag: "approval", decision: "approve" });
      const typed = textOf(yield* Fiber.join(typing));
      expect(typed).toContain('Typed "[redacted]"');

      const stored = JSON.stringify((yield* getThread(thread.id)).events);
      expect(stored).not.toContain("horse");
      expect(stored).not.toContain("tester@example.com");
      yield* interrupt(thread.id);
    }),
  );

  it.effect("tell the agent the names, and show a card to add one the project lacks", () =>
    Effect.gen(function* () {
      const project = yield* register("Cards");
      yield* saveSignIns(project.id, [DEMO]).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
      const { thread, mcp } = yield* browserThreadInTurn(project.id, project.vaultId, {});

      type Needed = { shown: boolean; notices: ReadonlyArray<string> };
      const known = yield* mcp.result<Needed>("browser_sign_in_needed", { site: "Demo", url: "http://localhost:4200/home" });
      expect(known.shown).toBe(false);
      expect(known.notices[0]).toContain("type DEMO_USER, DEMO_PASSWORD");

      const card = yield* mcp.result<Needed>("browser_sign_in_needed", { site: "Admin portal", url: "http://localhost:5000/signin", reason: "The settings page needs an admin." });
      expect(card.shown).toBe(true);
      const shown = (yield* getThread(thread.id)).events.map(({ event }) => event).find((event) => event._tag === "browser.sign_in_needed");
      expect(shown).toMatchObject({
        projectId: project.id,
        site: "Admin portal",
        origin: "http://localhost:5000",
        reason: "The settings page needs an admin.",
        href: `/projects/${project.id}?add-sign-in=Admin+portal&origin=http%3A%2F%2Flocalhost%3A5000#browser-sign-ins`,
      });
      yield* interrupt(thread.id);

      // A vault thread has no project to add one to.
      const { thread: vaultThread } = yield* post(`/api/vaults/${project.vaultId}/threads`, {}).pipe(Effect.flatMap(decode(CreateThreadResponse)));
      const vaultMcp = yield* mcpSession((yield* tokenFor(vaultThread.id, project.vaultId)).token);
      const refused = yield* vaultMcp.call("browser_sign_in_needed", { site: "Demo", url: "http://localhost:4200" });
      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toContain("belong to projects");
    }),
  );
});
