import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, layer } from "@effect/vitest";
import { DeleteMcpServerResponse } from "@wiki-agents/contracts/mcp-servers/delete-mcp-server/response";
import { GetMcpServerResponse } from "@wiki-agents/contracts/mcp-servers/get-mcp-server/response";
import { ListMcpServersResponse } from "@wiki-agents/contracts/mcp-servers/list-mcp-servers/response";
import type { McpServerInput } from "@wiki-agents/contracts/mcp-servers/model";
import { SaveMcpServerResponse } from "@wiki-agents/contracts/mcp-servers/save-mcp-server/response";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { TestApp } from "./infrastructure/test-app.js";
import { decode } from "./infrastructure/threads.js";

const list = HttpClient.get("/api/mcp-servers").pipe(Effect.flatMap(decode(ListMcpServersResponse)));
const get = (id: string) => HttpClient.get(`/api/mcp-servers/${id}`).pipe(Effect.flatMap(decode(GetMcpServerResponse)));
const save = (id: string, server: unknown, baseHash: string | null) =>
  HttpClient.execute(HttpClientRequest.put(`/api/mcp-servers/${id}`).pipe(HttpClientRequest.bodyJsonUnsafe({ server, baseHash })));
const saveOk = (id: string, server: McpServerInput, baseHash: string | null) => save(id, server, baseHash).pipe(Effect.flatMap(decode(SaveMcpServerResponse)));
const del = (id: string, hash: string) => HttpClient.execute(HttpClientRequest.delete(`/api/mcp-servers/${id}?hash=${hash}`));

const GITHUB: McpServerInput = {
  title: "GitHub",
  transport: { type: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer ${secret:github}" } },
  scope: "app",
  default: false,
  access: null,
  oauth: null,
  excludeTools: [],
};

const BROWSER: McpServerInput = {
  title: "Browser",
  transport: { type: "stdio", command: "npx", args: ["-y", "@playwright/mcp"], env: {}, cwd: null },
  scope: "thread",
  default: true,
  access: "ask",
  oauth: null,
  excludeTools: [],
};

layer(TestApp)("MCP servers", (it) => {
  it.effect("lists nothing before a server is added, and no folder is needed", () =>
    Effect.gen(function* () {
      const listed = yield* list;
      expect(listed).toMatchObject({ servers: [], problems: [] });
      expect(listed.folder).toMatch(/\/mcp$/);
      expect((yield* HttpClient.get("/api/mcp-servers/github")).status).toBe(404);
    }),
  );

  it.effect("creates servers, lists them by title and reads one back", () =>
    Effect.gen(function* () {
      const github = yield* saveOk("github", GITHUB, null);
      expect(github.server).toEqual({ id: "github", path: join((yield* list).folder, "github.yaml"), builtIn: false, ...GITHUB });
      expect(readFileSync(github.server.path, "utf8")).toBe(
        "title: GitHub\ntransport:\n  type: http\n  url: https://api.githubcopilot.com/mcp/\n  headers:\n    Authorization: Bearer ${secret:github}\nscope: app\ndefault: false\n",
      );
      yield* saveOk("browser", BROWSER, null);
      expect((yield* list).servers.map((server) => server.id)).toEqual(["browser", "github"]);
      expect(yield* get("github")).toEqual(github);
      expect((yield* get("browser")).server).toMatchObject(BROWSER);
    }),
  );

  it.effect("edits a server over the version it started from only", () =>
    Effect.gen(function* () {
      const before = yield* get("github");
      const saved = yield* saveOk("github", { ...GITHUB, default: true, access: "ask" }, before.hash);
      expect(saved.hash).not.toBe(before.hash);
      expect(saved.server).toMatchObject({ default: true, access: "ask" });

      const stale = yield* save("github", GITHUB, before.hash);
      expect(stale.status).toBe(409);
      expect(yield* stale.text).toMatch(/has changed since you opened it/);
      // Creating over an existing server is refused the same way.
      expect((yield* save("github", GITHUB, null)).status).toBe(409);
      expect((yield* get("github")).hash).toBe(saved.hash);
    }),
  );

  it.effect("refuses settings the loader wouldn't accept, naming each field", () =>
    Effect.gen(function* () {
      const problems = (server: unknown, id = "new") =>
        Effect.gen(function* () {
          const response = yield* save(id, server, null);
          expect(response.status).toBe(422);
          return (yield* response.text).split("\n");
        });
      expect(yield* problems({ ...GITHUB, title: " ", transport: { type: "http", url: "", headers: {} } })).toEqual([
        "title: Give the server a name.",
        "transport.url: Give the server's address.",
      ]);
      expect(yield* problems({ ...GITHUB, transport: { type: "http", url: "ftp://example.com", headers: {} } })).toEqual(["transport.url: An http:// or https:// address."]);
      expect(yield* problems({ ...GITHUB, transport: { type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer ${vault:x}" } } })).toEqual([
        expect.stringMatching(/^transport\.headers\.Authorization: /),
      ]);
      expect(yield* problems({ ...BROWSER, transport: { type: "stdio", command: "", args: [], env: {}, cwd: null } })).toEqual(["transport.command: Say which command to run."]);
      expect(yield* problems(GITHUB, "Not An Id")).toEqual([expect.stringMatching(/^id: /)]);
      // Not the request's shape at all.
      expect((yield* save("new", { title: "x" }, null)).status).toBe(400);
      expect((yield* list).servers.map((server) => server.id)).toEqual(["browser", "github"]);
    }),
  );

  it.effect("lists a file written by hand, and one that doesn't load with the reason", () =>
    Effect.gen(function* () {
      const { folder } = yield* list;
      writeFileSync(join(folder, "notes.yaml"), "# my notes server\ntransport:\n  type: stdio\n  command: notes-mcp\n");
      writeFileSync(join(folder, "broken.yaml"), "transport:\n  type: stdio\n  comand: oops\n");
      writeFileSync(join(folder, ".hidden.yaml"), "not: loaded\n");
      const listed = yield* list;
      expect(listed.servers.map((server) => server.id)).toEqual(["browser", "github", "notes"]);
      expect(listed.problems).toEqual([{ path: join(folder, "broken.yaml"), message: expect.stringContaining("transport.comand: Unknown setting; check the spelling.") }]);
      const broken = yield* HttpClient.get("/api/mcp-servers/broken");
      expect(broken.status).toBe(404);
      expect(yield* broken.text).toMatch(/can't be used: .*transport\.comand/);

      // Saving over the hand-written file keeps its comment.
      const notes = yield* get("notes");
      yield* saveOk("notes", { ...notes.server, title: "Notes" }, notes.hash);
      expect(readFileSync(join(folder, "notes.yaml"), "utf8")).toMatch(/^# my notes server\n/);
    }),
  );

  it.effect("deletes a server to the trash, only the version you saw", () =>
    Effect.gen(function* () {
      const { folder } = yield* list;
      const hash = (yield* get("browser")).hash ?? "";
      expect((yield* del("browser", "0".repeat(64))).status).toBe(409);
      const { trashPath } = yield* del("browser", hash).pipe(Effect.flatMap(decode(DeleteMcpServerResponse)));
      expect(trashPath).toBe(join(folder, "..", ".trash", "mcp", "browser.yaml"));
      expect(existsSync(trashPath)).toBe(true);
      expect(existsSync(join(folder, "browser.yaml"))).toBe(false);
      expect((yield* del("browser", hash)).status).toBe(404);
      expect((yield* del("Not An Id", hash)).status).toBe(400);

      // A second server of the same name goes beside the first in the trash.
      mkdirSync(folder, { recursive: true });
      const again = yield* saveOk("browser", BROWSER, null);
      const second = yield* del("browser", again.hash).pipe(Effect.flatMap(decode(DeleteMcpServerResponse)));
      expect(second.trashPath).toBe(join(folder, "..", ".trash", "mcp", "browser 1.yaml"));
    }),
  );
});
