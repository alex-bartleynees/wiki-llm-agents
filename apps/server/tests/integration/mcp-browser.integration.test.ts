import { chmodSync, existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, layer } from "@effect/vitest";
import { GetMcpServerResponse } from "@wiki-agents/contracts/mcp-servers/get-mcp-server/response";
import { ListMcpServersResponse } from "@wiki-agents/contracts/mcp-servers/list-mcp-servers/response";
import type { McpServerInput } from "@wiki-agents/contracts/mcp-servers/model";
import { TestMcpServerResponse } from "@wiki-agents/contracts/mcp-servers/test-mcp-server/response";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { BROWSER_EXCLUDED_TOOLS } from "../../src/features/mcp-servers/browser.js";
import { McpPool, type McpScopeContext } from "../../src/features/mcp-servers/pool.js";
import { makeTestApp } from "./infrastructure/test-app.js";
import { decode } from "./infrastructure/threads.js";

// The built-in browser, with the stdio stand-in in place of Playwright MCP: a command
// that takes the flags the app gives it, as `playwright-mcp` would.
const STDIO_SERVER = fileURLToPath(new URL("./infrastructure/stand-in-mcp-stdio.mjs", import.meta.url));
const work = realpathSync(mkdtempSync(join(tmpdir(), "wiki-agents-browser-")));
const command = join(work, "playwright-mcp");
writeFileSync(command, `#!/bin/sh\nexec "${process.execPath}" "${STDIO_SERVER}" "$@"\n`);
chmodSync(command, 0o755);
// Not there yet: the app makes it before the browser first starts.
const stateDir = join(work, "data", "browser");
const browser = { command, stateDir, blockedOrigins: ["http://127.0.0.1:4317", "http://localhost:4317"] };

const list = HttpClient.get("/api/mcp-servers").pipe(Effect.flatMap(decode(ListMcpServersResponse)));
const get = (id: string) => HttpClient.get(`/api/mcp-servers/${id}`);
const save = (id: string, server: McpServerInput, baseHash: string | null) =>
  HttpClient.execute(HttpClientRequest.put(`/api/mcp-servers/${id}`).pipe(HttpClientRequest.bodyJsonUnsafe({ server, baseHash })));
const testServer = (id: string) => HttpClient.execute(HttpClientRequest.post(`/api/mcp-servers/${id}/test`)).pipe(Effect.flatMap(decode(TestMcpServerResponse)));
const thread = (threadId: string): McpScopeContext => ({ threadId, projectId: "project-1", cwd: work });
const call = (id: string, context: McpScopeContext, tool: string) => Effect.flatMap(Effect.service(McpPool), (pool) => pool.callTool(id, context, tool, {}));
const textOf = (result: Readonly<Record<string, unknown>>) => (result["content"] as ReadonlyArray<{ readonly text: string }>)[0]?.text;

layer(makeTestApp({ browser }))("the built-in browser", (it) => {
  it.effect("is listed when the app is given its command, with a connection per thread and its risky tools left out", () =>
    Effect.gen(function* () {
      const { folder, servers } = yield* list;
      const playwright = servers.find((server) => server.id === "playwright");
      expect(playwright).toMatchObject({
        builtIn: true,
        path: join(folder, "playwright.yaml"),
        scope: "thread",
        default: false,
        access: null,
        excludeTools: [...BROWSER_EXCLUDED_TOOLS],
        transport: { type: "stdio", command, cwd: stateDir },
      });
      expect(existsSync(stateDir)).toBe(true);
      // No file: nothing to save over or delete.
      expect(yield* get("playwright").pipe(Effect.flatMap(decode(GetMcpServerResponse)))).toMatchObject({ hash: null, server: { builtIn: true } });
      expect((yield* HttpClient.execute(HttpClientRequest.delete(`/api/mcp-servers/playwright?hash=${"0".repeat(64)}`))).status).toBe(404);
    }),
  );

  it.effect("runs headless and isolated in its state folder, with the app's own addresses blocked", () =>
    Effect.gen(function* () {
      expect(textOf(yield* call("playwright", thread("t1"), "cwd"))).toBe(stateDir);
      expect(textOf(yield* call("playwright", thread("t1"), "args"))?.split("\n")).toEqual([
        "--headless",
        "--isolated",
        "--output-dir",
        join(stateDir, "output"),
        "--blocked-origins",
        "http://127.0.0.1:4317;http://localhost:4317",
      ]);
    }),
  );

  it.effect("is replaced by a file with its id", () =>
    Effect.gen(function* () {
      const { servers } = yield* list;
      const builtIn = servers.find((server) => server.id === "playwright");
      if (builtIn === undefined) return yield* Effect.die("no built-in browser");
      const { id: _id, path: _path, builtIn: _builtIn, ...input } = builtIn;
      expect((yield* save("playwright", { ...input, title: "My browser", excludeTools: [] }, null)).status).toBe(200);
      const after = (yield* list).servers.filter((server) => server.id === "playwright");
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({ title: "My browser", builtIn: false, excludeTools: [] });
    }),
  );
});

layer(makeTestApp())("tools a server's file leaves out", (it) => {
  it.effect("aren't listed, given or called", () =>
    Effect.gen(function* () {
      const server: McpServerInput = {
        title: "Stand-in",
        transport: { type: "stdio", command: process.execPath, args: [STDIO_SERVER], env: {}, cwd: null },
        scope: "thread",
        default: false,
        access: null,
        oauth: null,
        excludeTools: ["echo", "exit"],
        browserSignIns: false,
      };
      expect((yield* save("stand-in", server, null)).status).toBe(200);
      const { status } = yield* testServer("stand-in");
      expect(status.tools?.map((tool) => tool.name)).toEqual(["env", "cwd", "args"]);
      const pool = yield* McpPool;
      expect((yield* pool.tools("stand-in", thread("t2"))).map((tool) => tool.name)).toEqual(["env", "cwd", "args"]);
      const refused = yield* Effect.flip(call("stand-in", thread("t2"), "echo"));
      expect(refused._tag).toBe("McpToolNotFound");
    }),
  );

  it.effect("and without the app's command there is no built-in browser", () =>
    Effect.gen(function* () {
      expect((yield* list).servers.some((server) => server.builtIn)).toBe(false);
      expect((yield* get("playwright")).status).toBe(404);
    }),
  );
});
