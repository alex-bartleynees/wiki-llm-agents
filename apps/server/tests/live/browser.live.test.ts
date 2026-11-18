import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll } from "vitest";
import { BROWSER_SERVER_ID } from "../../src/features/mcp-servers/browser.js";
import { McpPool, type McpScopeContext } from "../../src/features/mcp-servers/pool.js";
import { makeTestApp } from "../integration/infrastructure/test-app.js";

/**
 * The built-in browser with the real Playwright MCP, through the app's connection pool:
 *
 *   WIKI_AGENTS_LIVE_BROWSER=1 WIKI_AGENTS_BROWSER_MCP=$(nix build --print-out-paths nixpkgs#playwright-mcp)/bin/playwright-mcp \
 *     nix develop -c npx -w @wiki-agents/server vitest run tests/live/browser.live.test.ts
 *
 * No model and no provider: it checks what the app gives agents, not what they do with it.
 */
const live = process.env["WIKI_AGENTS_LIVE_BROWSER"] === "1" && (process.env["WIKI_AGENTS_BROWSER_MCP"] ?? "") !== "";

const listen = (handle: (path: string) => string) =>
  new Promise<{ readonly server: Server; readonly origin: string }>((resolve) => {
    const server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(handle(request.url ?? "/"));
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });

// The preview an agent reviews: counts its visits in localStorage and logs an error.
const preview = live ? await listen(() => "<!doctype html><title>Preview</title><script>localStorage.n = Number(localStorage.n || 0) + 1; document.title = 'visits ' + localStorage.n; console.error('preview broke');</script><h1>Preview</h1>") : null;
// Stands in for the app itself, which the browser must not reach.
const app = live ? await listen(() => "<!doctype html><title>The app</title><h1>Settings</h1>") : null;
afterAll(() => {
  preview?.server.close();
  app?.server.close();
});

const browser = {
  command: process.env["WIKI_AGENTS_BROWSER_MCP"] ?? "",
  stateDir: join(mkdtempSync(join(tmpdir(), "wiki-agents-browser-live-")), "browser"),
  blockedOrigins: app === null ? [] : [app.origin],
};

type Result = { readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string; readonly mimeType?: string; readonly data?: string }>; readonly isError?: boolean };
const thread = (threadId: string): McpScopeContext => ({ threadId, projectId: null, cwd: null });
const call = (context: McpScopeContext, tool: string, args: Record<string, unknown> = {}) =>
  Effect.flatMap(Effect.service(McpPool), (pool) => pool.callTool(BROWSER_SERVER_ID, context, tool, args)) as unknown as Effect.Effect<Result, unknown, McpPool>;
const textOf = (result: Result) => result.content.flatMap((part) => (part.text === undefined ? [] : [part.text])).join("\n");

describe.skipIf(!live)("the built-in browser with Playwright MCP", () => {
  layer(makeTestApp({ browser }), { timeout: 120_000 })("a thread's browser", (it) => {
    it.effect("gives agents the safe tools only", () =>
      Effect.gen(function* () {
        const names = (yield* (yield* McpPool).tools(BROWSER_SERVER_ID, thread("t1"))).map((tool) => tool.name);
        expect(names).toEqual(expect.arrayContaining(["browser_navigate", "browser_take_screenshot", "browser_snapshot", "browser_console_messages", "browser_resize"]));
        for (const left of ["browser_run_code_unsafe", "browser_file_upload", "browser_evaluate"]) expect(names).not.toContain(left);
      }),
    );

    it.effect("opens a preview, shows it at desktop and phone widths as images, and reports console errors", () =>
      Effect.gen(function* () {
        yield* call(thread("t1"), "browser_navigate", { url: preview?.origin });
        for (const [width, height] of [[1440, 900], [390, 844]] as const) {
          yield* call(thread("t1"), "browser_resize", { width, height });
          const shot = yield* call(thread("t1"), "browser_take_screenshot");
          const image = shot.content.find((part) => part.type === "image");
          expect(image?.mimeType).toBe("image/png");
          expect(image?.data?.length ?? 0).toBeGreaterThan(1000);
        }
        expect(textOf(yield* call(thread("t1"), "browser_console_messages", { level: "error" }))).toContain("preview broke");
      }),
    );

    it.effect("keeps each thread's browser state apart", () =>
      Effect.gen(function* () {
        yield* call(thread("t1"), "browser_navigate", { url: preview?.origin });
        expect(textOf(yield* call(thread("t1"), "browser_snapshot"))).toContain("visits 2");
        yield* call(thread("t2"), "browser_navigate", { url: preview?.origin });
        expect(textOf(yield* call(thread("t2"), "browser_snapshot"))).toContain("visits 1");
      }),
    );

    it.effect("doesn't load the app's own pages", () =>
      Effect.gen(function* () {
        const result = yield* call(thread("t3"), "browser_navigate", { url: app?.origin });
        const snapshot = textOf(yield* call(thread("t3"), "browser_snapshot"));
        expect(snapshot).not.toContain("Settings");
        expect(`${textOf(result)}\n${snapshot}`).toMatch(/ERR_BLOCKED_BY_CLIENT|blocked/i);
      }),
    );
  });
});
