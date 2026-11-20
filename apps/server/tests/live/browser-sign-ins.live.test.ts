import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, layer } from "@effect/vitest";
import type { BrowserSignIn } from "@wiki-agents/contracts/projects/model";
import { Effect, Fiber } from "effect";
import { HttpClientResponse } from "effect/http";
import { afterAll } from "vitest";
import { browserThreadInTurn, isToolRequest, registerProject, saveSignIns, setSecret } from "../integration/infrastructure/browser-sign-ins.js";
import type { ToolResult } from "../integration/infrastructure/mcp.js";
import { makeTestApp } from "../integration/infrastructure/test-app.js";
import { answer, getThread, interrupt } from "../integration/infrastructure/threads.js";

/**
 * A browser sign-in end to end with the real Playwright MCP, through the app's `/mcp`
 * gateway, against a fake login page:
 *
 *   WIKI_AGENTS_LIVE_BROWSER=1 WIKI_AGENTS_BROWSER_MCP=$(nix build --print-out-paths nixpkgs#playwright-mcp)/bin/playwright-mcp \
 *     nix develop -c npx -w @wiki-agents/server vitest run tests/live/browser-sign-ins.live.test.ts
 *
 * No model and no provider: the test makes the calls an agent would. It checks what the
 * stand-in browser in `browser-sign-ins.integration.test.ts` can't: that Playwright reads
 * the app's secrets file back exactly (a password with quotes and spaces), that the
 * guard finds the page in Playwright's real answers, and that the values never come back.
 */
const live = process.env["WIKI_AGENTS_LIVE_BROWSER"] === "1" && (process.env["WIKI_AGENTS_BROWSER_MCP"] ?? "") !== "";

const USER = "tester@example.com";
const PASSWORD = "correct horse 'battery' staple";

const readBody = (request: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    request.on("end", () => resolve(body));
  });

const page = (response: ServerResponse, title: string, body: string, headers: Record<string, string> = {}) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", ...headers });
  response.end(`<!doctype html><title>${title}</title>${body}`);
};

const LOGIN_FORM = '<h1>Sign in</h1><form method="post" action="/login"><label>Email <input name="email"></label><label>Password <input type="password" name="password"></label><button>Sign in</button></form>';

/** The fake app: a login form, a home page behind a session cookie, and every submitted sign-in kept. */
const fakeLogin = () => {
  const submitted: Array<{ readonly email: string; readonly password: string }> = [];
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method === "POST" && request.url === "/login") {
      const form = new URLSearchParams(await readBody(request));
      const attempt = { email: form.get("email") ?? "", password: form.get("password") ?? "" };
      submitted.push(attempt);
      if (attempt.email !== USER || attempt.password !== PASSWORD) return page(response, "Sign in", `<p>Wrong email or password for ${attempt.email}.</p>${LOGIN_FORM}`);
      response.writeHead(303, { location: "/home", "set-cookie": "session=ok; HttpOnly; Path=/" });
      return response.end();
    }
    if (request.url === "/home") {
      if (request.headers.cookie?.includes("session=ok") === true) return page(response, "Home", `<h1>Welcome back</h1><p>Signed in as ${USER}</p>`);
      response.writeHead(303, { location: "/login" });
      return response.end();
    }
    return page(response, "Sign in", LOGIN_FORM);
  };
  return { submitted, handle };
};

const listen = (handle: (request: IncomingMessage, response: ServerResponse) => unknown) =>
  new Promise<{ readonly server: Server; readonly origin: string }>((resolve) => {
    const server = createServer((request, response) => void handle(request, response));
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });

const login = fakeLogin();
const app = live ? await listen(login.handle) : null;
// Another site with the same form: the credentials may not be typed there.
const elsewhere = live ? await listen((_, response) => page(response, "Sign in", LOGIN_FORM)) : null;

const work = realpathSync(mkdtempSync(join(tmpdir(), "wiki-agents-sign-ins-live-")));
const vaultRoot = join(work, "vault");
const appDir = join(work, "app");
for (const dir of [vaultRoot, appDir]) mkdirSync(dir, { recursive: true });
writeFileSync(join(vaultRoot, "index.md"), "# Shared");
afterAll(() => {
  app?.server.close();
  elsewhere?.server.close();
  rmSync(work, { recursive: true, force: true });
});

const browser = { command: process.env["WIKI_AGENTS_BROWSER_MCP"] ?? "", stateDir: join(work, "browser"), blockedOrigins: [] };

const SIGN_IN: BrowserSignIn = {
  name: "Fake app",
  origins: [app?.origin ?? "http://127.0.0.1:1"],
  credentials: [
    { variable: "FAKE_USER", secret: "fake-user" },
    { variable: "FAKE_PASSWORD", secret: "fake-password" },
  ],
};

const textOf = (result: ToolResult) => result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");

/** The `ref` Playwright's snapshot gives the element with this role and name. */
const refOf = (snapshot: string, role: string, name: string) => {
  const ref = new RegExp(`${role} "${name}"[^\\n]*\\[ref=(\\w+)\\]`).exec(snapshot)?.[1];
  if (ref === undefined) throw new Error(`no ${role} "${name}" in the snapshot:\n${snapshot}`);
  return ref;
};

/** The `browser_fill_form` arguments typing both credentials' names into the form in `snapshot`. */
const fillBoth = (snapshot: string) => ({
  fields: [
    { name: "Email", type: "textbox", target: refOf(snapshot, "textbox", "Email"), value: "FAKE_USER" },
    { name: "Password", type: "textbox", target: refOf(snapshot, "textbox", "Password"), value: "FAKE_PASSWORD" },
  ],
});

describe.skipIf(!live)("a browser sign-in with Playwright MCP", () => {
  layer(makeTestApp({ browser, vaults: [vaultRoot] }), { timeout: 120_000 })("on a fake login page", (it) => {
    it.effect("signs in on its site after asking, and refuses another site, without the values ever showing", () =>
      Effect.gen(function* () {
        yield* setSecret("fake-user", USER);
        yield* setSecret("fake-password", PASSWORD);
        const project = yield* registerProject("Fake app", appDir);
        yield* saveSignIns(project.id, [SIGN_IN]).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
        const { thread, events, mcp } = yield* browserThreadInTurn(project.id, project.vaultId, { tools: "allow", subagents: "allow" });

        // The same form on another site: refused from the page Playwright reports, before the browser types anything.
        // (A navigation's answer links its snapshot as a file; `browser_snapshot` gives it inline.)
        yield* mcp.call("playwright__browser_navigate", { url: `${elsewhere?.origin}/login` });
        const there = textOf(yield* mcp.call("playwright__browser_snapshot"));
        const refused = yield* mcp.call("playwright__browser_fill_form", fillBoth(there));
        expect(refused.isError).toBe(true);
        expect(textOf(refused)).toContain(`FAKE_USER may only be typed on ${app?.origin}`);
        expect(textOf(refused)).toContain(`the page is ${elsewhere?.origin}/login`);

        // On the sign-in's site, it asks first, naming the credentials and the page.
        yield* mcp.call("playwright__browser_navigate", { url: `${app?.origin}/login` });
        const form = textOf(yield* mcp.call("playwright__browser_snapshot"));
        const filling = yield* Effect.forkChild(mcp.call("playwright__browser_fill_form", fillBoth(form)));
        const opened = (yield* events.until(isToolRequest, "0 seconds")).find(isToolRequest);
        if (opened?._tag !== "request.opened" || opened.prompt._tag !== "approval") return yield* Effect.die("no approval was asked for");
        expect(opened.prompt.detail).toContain(`Types FAKE_USER (sign-in "Fake app"), FAKE_PASSWORD (sign-in "Fake app") on ${app?.origin}/login.`);
        yield* answer(thread.id, opened.requestId, { _tag: "approval", decision: "approve" });
        const filled = yield* Fiber.join(filling);
        expect(filled.isError, textOf(filled)).not.toBe(true);

        // Clicking Sign in doesn't ask (`tools: allow`), and the browser sent the values exactly.
        const signedIn = textOf(yield* mcp.call("playwright__browser_click", { element: "Sign in button", target: refOf(form, "button", "Sign in") }));
        expect(login.submitted).toEqual([{ email: USER, password: PASSWORD }]);
        const home = `${signedIn}\n${textOf(yield* mcp.call("playwright__browser_snapshot"))}`;
        expect(home).toContain("Welcome back");
        expect(home).toContain("Signed in as");
        expect(home).toContain(`${app?.origin}/home`);

        // No value reached the agent, nor the thread's stored events.
        for (const value of [USER, "horse"]) {
          expect(`${there}\n${form}\n${textOf(filled)}\n${home}`).not.toContain(value);
          expect(JSON.stringify((yield* getThread(thread.id)).events)).not.toContain(value);
        }
        yield* interrupt(thread.id);
      }),
    );
  });
});
