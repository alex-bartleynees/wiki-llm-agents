import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, layer } from "@effect/vitest";
import { GetMcpServerResponse } from "@wiki-agents/contracts/mcp-servers/get-mcp-server/response";
import { ListMcpServersResponse } from "@wiki-agents/contracts/mcp-servers/list-mcp-servers/response";
import type { McpServerInput } from "@wiki-agents/contracts/mcp-servers/model";
import { RestartMcpServerResponse } from "@wiki-agents/contracts/mcp-servers/restart-mcp-server/response";
import { TestMcpServerResponse } from "@wiki-agents/contracts/mcp-servers/test-mcp-server/response";
import { StartConnectResponse } from "@wiki-agents/contracts/mcp-oauth/start-connect/response";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { afterAll } from "vitest";
import { McpPool, type McpScopeContext } from "../../src/features/mcp-servers/pool.js";
import { BACKOFF_FIRST_MS } from "../../src/features/mcp-servers/pool-live.js";
import { WallClock } from "../../src/shared/wall-clock.js";
import { startStandInIdentity } from "./infrastructure/stand-in-identity.js";
import { startStandInMcp } from "./infrastructure/stand-in-mcp.js";
import { makeTestApp, makeTestSecrets } from "./infrastructure/test-app.js";
import { decode } from "./infrastructure/threads.js";

// Read when the app starts: one of the app's own settings, which no server may see, and
// a variable a server's `${env:…}` names.
process.env["WIKI_AGENTS_POOL_PROBE"] = "app-setting";
process.env["POOL_TEST_FROM_ENV"] = "env-secret-value";

const GITHUB_TOKEN = "ghp_secret-value";
const github = await startStandInMcp({ authorization: `Bearer ${GITHUB_TOKEN}` });
const legacy = await startStandInMcp({ versions: ["2025-06-18"] });
const shared = await startStandInMcp();
const flaky = await startStandInMcp();
const identity = await startStandInIdentity({ mcp: true });
afterAll(async () => {
  for (const server of [github, legacy, shared, flaky, identity]) await server.close();
});

const STDIO_SERVER = fileURLToPath(new URL("./infrastructure/stand-in-mcp-stdio.mjs", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "wiki-agents-pool-"));
const projectDir = realpathSync(mkdtempSync(join(work, "project-")));
const secretFile = join(work, "token");
writeFileSync(secretFile, "file-secret-value\n");

const http = (url: string, extra: Partial<McpServerInput> = {}): McpServerInput => ({
  title: "Server",
  transport: { type: "http", url, headers: {} },
  scope: "app",
  default: false,
  access: null,
  oauth: null,
  excludeTools: [],
  browserSignIns: false,
  ...extra,
});

const saveServer = (id: string, input: McpServerInput) =>
  Effect.gen(function* () {
    const existing = yield* HttpClient.get(`/api/mcp-servers/${id}`);
    const baseHash = existing.status === 200 ? (yield* decode(GetMcpServerResponse)(existing)).hash : null;
    const saved = yield* HttpClient.execute(HttpClientRequest.put(`/api/mcp-servers/${id}`).pipe(HttpClientRequest.bodyJsonUnsafe({ server: input, baseHash })));
    if (saved.status !== 200) return yield* Effect.die(`save ${id}: ${saved.status} ${yield* saved.text}`);
  });
const setSecret = (name: string, value: string) =>
  HttpClient.execute(HttpClientRequest.put(`/api/secrets/${name}`).pipe(HttpClientRequest.bodyJsonUnsafe({ value, expiresAt: null }))).pipe(
    Effect.tap((response) => (response.status === 200 ? Effect.void : Effect.die(`secret ${name}: ${response.status}`))),
  );
const testServer = (id: string) => HttpClient.execute(HttpClientRequest.post(`/api/mcp-servers/${id}/test`)).pipe(Effect.flatMap(decode(TestMcpServerResponse)));
const restartServer = (id: string) => HttpClient.execute(HttpClientRequest.post(`/api/mcp-servers/${id}/restart`)).pipe(Effect.flatMap(decode(RestartMcpServerResponse)));
const listText = HttpClient.get("/api/mcp-servers").pipe(Effect.flatMap((response) => response.text));
const statusOf = (id: string) =>
  HttpClient.get("/api/mcp-servers").pipe(
    Effect.flatMap(decode(ListMcpServersResponse)),
    Effect.map(({ statuses }) => statuses.find((status) => status.serverId === id)),
  );

const thread = (threadId: string, projectId: string | null = null, cwd: string | null = null): McpScopeContext => ({ threadId, projectId, cwd });
const tools = (id: string, context: McpScopeContext) => Effect.flatMap(Effect.service(McpPool), (pool) => pool.tools(id, context));
const call = (id: string, context: McpScopeContext, tool: string, args: Record<string, unknown> = {}) => Effect.flatMap(Effect.service(McpPool), (pool) => pool.callTool(id, context, tool, args));
/** The first text a tool answered with. */
const textOf = (result: Readonly<Record<string, unknown>>) => (result["content"] as ReadonlyArray<{ readonly text: string }>)[0]?.text;

layer(makeTestApp({ secrets: makeTestSecrets() }))("MCP connection pool", (it) => {
  it.effect("tests a server with its secret in a header, marks read-only tools, and never shows the token", () =>
    Effect.gen(function* () {
      yield* setSecret("github", GITHUB_TOKEN);
      yield* saveServer("github", http(github.url, { title: "GitHub", transport: { type: "http", url: github.url, headers: { Authorization: "Bearer ${secret:github}" } } }));
      expect(yield* statusOf("github")).toMatchObject({ state: "idle", connections: 0, tools: null });

      const { status } = yield* testServer("github");
      // The test's own connection is closed again; threads' connections are separate.
      expect(status).toMatchObject({ serverId: "github", state: "idle", connections: 0, protocolVersion: "2025-11-25", problem: null, retryAt: null });
      expect(status.tools).toEqual([
        { name: "echo", title: "Echo", description: "Says the text back.", readOnly: true },
        { name: "whoami", title: null, description: "Says back the Authorization header it got.", readOnly: false },
        { name: "fail", title: null, description: "Always fails.", readOnly: false },
      ]);
      expect(github.requests.find((request) => request.method === "initialize")?.authorization).toBe(`Bearer ${GITHUB_TOKEN}`);

      // An upstream that echoes the token gets it redacted, wherever it appears.
      expect(textOf(yield* call("github", thread("t1"), "whoami"))).toBe("You sent Bearer [redacted]");
      expect(textOf(yield* call("github", thread("t1"), "echo", { text: `token=${GITHUB_TOKEN}` }))).toBe("token=[redacted]");
      // A tool's own error is a result, for the agent to read.
      expect(yield* call("github", thread("t1"), "fail")).toMatchObject({ isError: true, content: [{ type: "text", text: "It went wrong." }] });
      expect((yield* call("github", thread("t1"), "nope").pipe(Effect.flip))._tag).toBe("McpToolNotFound");

      expect(yield* statusOf("github")).toMatchObject({ state: "connected", connections: 1 });
      expect(yield* listText).not.toContain(GITHUB_TOKEN);

      // A wrong token: the server refuses it, and Settings says to check the secret.
      yield* setSecret("github", "ghp_wrong-token");
      const refused = yield* testServer("github");
      expect(refused.status).toMatchObject({ state: "connected", problem: "GitHub refused its Authorization header (401); check the secret it refers to." });
      yield* setSecret("github", GITHUB_TOKEN);
    }),
  );

  it.effect("shares one connection for an app server, one per project or thread otherwise, and reconnects when the file changes", () =>
    Effect.gen(function* () {
      const opened = () => shared.connections();
      yield* saveServer("shared", http(shared.url, { title: "Shared", scope: "app" }));
      yield* tools("shared", thread("t1"));
      yield* tools("shared", thread("t2", "p1"));
      expect(opened()).toBe(1);

      yield* saveServer("per-project", http(shared.url, { title: "Per project", scope: "project" }));
      yield* tools("per-project", thread("t1", "p1"));
      yield* tools("per-project", thread("t2", "p1"));
      yield* tools("per-project", thread("t3", "p2"));
      // A thread outside any project gets its own.
      yield* tools("per-project", thread("t4"));
      expect(opened()).toBe(4);

      yield* saveServer("per-thread", http(shared.url, { title: "Per thread", scope: "thread" }));
      yield* tools("per-thread", thread("t1", "p1"));
      yield* tools("per-thread", thread("t2", "p1"));
      yield* tools("per-thread", thread("t1", "p1"));
      expect(opened()).toBe(6);
      expect(yield* statusOf("per-project")).toMatchObject({ state: "connected", connections: 3 });

      // Edited: the next use opens a new connection with the new settings, and the old one closes.
      yield* saveServer("shared", http(shared.url, { title: "Shared", transport: { type: "http", url: shared.url, headers: { "X-Edited": "yes" } } }));
      yield* tools("shared", thread("t1"));
      expect(opened()).toBe(7);
      expect(yield* statusOf("shared")).toMatchObject({ connections: 1 });
    }),
  );

  it.effect("speaks 2025-06-18 to a server that knows nothing newer", () =>
    Effect.gen(function* () {
      yield* saveServer("legacy", http(legacy.url, { title: "Legacy" }));
      expect((yield* testServer("legacy")).status).toMatchObject({ protocolVersion: "2025-06-18", problem: null });
      expect(legacy.requests.filter((request) => request.method === "initialize").length).toBe(2);
      // Remembered: the pool's own connection asks for it first.
      expect(textOf(yield* call("legacy", thread("t1"), "echo", { text: "hello" }))).toBe("hello");
      expect(legacy.requests.filter((request) => request.method === "initialize").length).toBe(3);
      expect(legacy.requests.at(-1)?.protocolVersion).toBe("2025-06-18");
    }),
  );

  it.effect("waits longer after each failure, and Restart tries again at once", () =>
    Effect.gen(function* () {
      const clock = yield* WallClock;
      flaky.setDown(true);
      yield* saveServer("flaky", http(flaky.url, { title: "Flaky" }));
      const first = yield* tools("flaky", thread("t1")).pipe(Effect.flip);
      expect(first).toMatchObject({ _tag: "McpServerUnavailable", reason: "Flaky answered 503." });

      // Within the wait, nothing is sent.
      const sent = flaky.requests.length;
      expect((yield* tools("flaky", thread("t1")).pipe(Effect.flip)).reason).toBe("Flaky answered 503. Trying again in 1 s.");
      expect(flaky.requests.length).toBe(sent);
      const failed = yield* statusOf("flaky");
      expect(failed).toMatchObject({ state: "failed", problem: "Flaky answered 503." });
      expect(failed?.retryAt).toBeGreaterThan(0);

      // After it, one more try, then twice as long.
      yield* clock.advance(BACKOFF_FIRST_MS);
      expect((yield* tools("flaky", thread("t1")).pipe(Effect.flip)).reason).toBe("Flaky answered 503.");
      expect((yield* tools("flaky", thread("t1")).pipe(Effect.flip)).reason).toBe("Flaky answered 503. Trying again in 2 s.");

      flaky.setDown(false);
      const { status } = yield* restartServer("flaky");
      expect(status).toMatchObject({ state: "connected", connections: 1, problem: null, retryAt: null });
      expect((yield* tools("flaky", thread("t2"))).map((tool) => tool.name)).toEqual(["echo", "whoami", "fail"]);
    }),
  );

  it.effect("runs a stdio server in the project's folder with its references filled in, and without the app's settings", () =>
    Effect.gen(function* () {
      yield* setSecret("stdio-token", "stdio-secret-value");
      yield* saveServer("local", {
        ...http("http://unused"),
        title: "Local",
        scope: "project",
        transport: {
          type: "stdio",
          command: process.execPath,
          args: [STDIO_SERVER],
          env: { FROM_SECRET: "${secret:stdio-token}", FROM_ENV: "${env:POOL_TEST_FROM_ENV}", FROM_FILE: "${file:" + secretFile + "}", PLAIN: "plain" },
          cwd: null,
        },
      });
      const here = thread("t1", "p1", projectDir);
      const env = (name: string) => Effect.map(call("local", here, "env", { name }), textOf);
      // Each value reached the server: it came back, and was redacted on the way out.
      expect(yield* env("FROM_SECRET")).toBe("[redacted]");
      expect(yield* env("FROM_ENV")).toBe("[redacted]");
      expect(yield* env("FROM_FILE")).toBe("[redacted]");
      expect(yield* env("PLAIN")).toBe("plain");
      expect(yield* env("WIKI_AGENTS_POOL_PROBE")).toBe("(unset)");
      expect(yield* env("PATH")).not.toBe("(unset)");
      expect(textOf(yield* call("local", here, "cwd"))).toBe(projectDir);

      // The process exits: that call fails, and the next one starts it again.
      const crashed = yield* call("local", here, "exit").pipe(Effect.flip);
      expect(crashed._tag).toBe("McpServerUnavailable");
      expect(textOf(yield* call("local", here, "echo", { text: "back" }))).toBe("back");

      // A reference that can't be filled in says which, and nothing starts.
      yield* saveServer("missing", { ...http("http://unused"), title: "Missing", transport: { type: "stdio", command: process.execPath, args: [STDIO_SERVER], env: { T: "${secret:nope}" }, cwd: null } });
      expect((yield* testServer("missing")).status).toMatchObject({ state: "failed", problem: expect.stringMatching(/^transport\.env\.T: .*nope/) });
      yield* saveServer("no-command", { ...http("http://unused"), title: "No command", transport: { type: "stdio", command: "wiki-agents-no-such-command", args: [], env: {}, cwd: null } });
      expect((yield* testServer("no-command")).status.problem).toMatch(/^Cannot spawn MCP server/);
    }),
  );

  it.effect("sends the sign-in's token to a server that asked for one, and says to connect when not signed in", () =>
    Effect.gen(function* () {
      yield* saveServer("journal", http(identity.mcpUrl, { title: "Journal", oauth: { clientId: "journal-agent", scopes: ["journal:read"] } }));
      expect((yield* testServer("journal")).status).toMatchObject({ state: "failed", problem: expect.stringMatching(/^Journal asks you to sign in: Not signed in to Journal/) });

      const started = yield* HttpClient.execute(HttpClientRequest.post("/api/mcp-servers/journal/connect")).pipe(Effect.flatMap(decode(StartConnectResponse)));
      yield* Effect.promise(async () => {
        const back = (await fetch(started.authorizationUrl, { redirect: "manual" })).headers.get("location") ?? "";
        await fetch(back, { redirect: "manual" });
      });

      expect((yield* testServer("journal")).status).toMatchObject({ problem: null, tools: expect.arrayContaining([expect.objectContaining({ name: "echo" })]) });
      expect(identity.mcpRequests.at(-1)?.authorization).toMatch(/^Bearer access-\d+$/);
      expect(textOf(yield* call("journal", thread("t1"), "whoami"))).toBe("You sent Bearer [redacted]");
    }),
  );

  it.effect("answers 404 for a server that doesn't exist", () =>
    Effect.gen(function* () {
      for (const action of ["test", "restart"]) {
        expect((yield* HttpClient.execute(HttpClientRequest.post(`/api/mcp-servers/nope/${action}`))).status).toBe(404);
      }
    }),
  );
});
