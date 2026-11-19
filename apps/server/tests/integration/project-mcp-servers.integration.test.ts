import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, layer } from "@effect/vitest";
import { GetProjectMcpServersResponse } from "@wiki-agents/contracts/projects/get-project-mcp-servers/response";
import { RegisterProjectResponse } from "@wiki-agents/contracts/projects/register-project/response";
import { SaveProjectMcpServersResponse } from "@wiki-agents/contracts/projects/save-project-mcp-servers/response";
import { CreateThreadResponse } from "@wiki-agents/contracts/threads/create-thread/response";
import type { ThreadEvent } from "@wiki-agents/contracts/threads/model";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { afterAll } from "vitest";
import { ThreadActors } from "../../src/features/threads/thread-actors.js";
import { mcpSession, tokenFor } from "./infrastructure/mcp.js";
import { startStandInMcp } from "./infrastructure/stand-in-mcp.js";
import { makeTestApp } from "./infrastructure/test-app.js";
import { decode, interrupt, post, setAgent, watch } from "./infrastructure/threads.js";

const upstream = await startStandInMcp();
const work = realpathSync(mkdtempSync(join(tmpdir(), "wiki-agents-project-mcp-")));
afterAll(async () => {
  await upstream.close();
  rmSync(work, { recursive: true, force: true });
});
const sharedRoot = join(work, "vault");
const appDir = join(work, "app");
for (const dir of [sharedRoot, appDir]) mkdirSync(dir, { recursive: true });
writeFileSync(join(sharedRoot, "index.md"), "# Shared");

const register = (name: string) =>
  post("/api/projects", { name, workingDirectories: [appDir] }).pipe(Effect.flatMap(decode(RegisterProjectResponse)), Effect.map((result) => result.project));
const serversPath = (projectId: string) => `/api/projects/${projectId}/mcp-servers`;
const saveServers = (projectId: string, serverIds: ReadonlyArray<string>) =>
  HttpClient.execute(HttpClientRequest.put(serversPath(projectId)).pipe(HttpClientRequest.bodyJsonUnsafe({ serverIds })));
/** A server in Settings › MCP servers that no agent lists and isn't for every thread. */
const addServer = (id: string) =>
  HttpClient.execute(HttpClientRequest.put(`/api/mcp-servers/${id}`).pipe(HttpClientRequest.bodyJsonUnsafe({
    baseHash: null,
    server: { title: id, transport: { type: "http", url: upstream.url, headers: {} }, scope: "app", default: false, access: null, oauth: null },
  }))).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));

const isQuestion = (event: ThreadEvent) => event._tag === "request.opened" && event.prompt._tag === "question";

/** A thread (in `projectId`, or none) with no agent, a turn running, and the names of the tools its entry lists. */
const turnTools = (vaultId: string, projectId: string | null) =>
  Effect.gen(function* () {
    const { thread } = yield* post(`/api/vaults/${vaultId}/threads`, projectId === null ? {} : { projectId }).pipe(Effect.flatMap(decode(CreateThreadResponse)));
    yield* setAgent(thread.id, null);
    const events = yield* watch(thread.id);
    yield* (yield* ThreadActors).sendMessage(thread.id, "Ask me a question");
    const seen = yield* events.until(isQuestion);
    const mcp = yield* mcpSession((yield* tokenFor(thread.id, vaultId)).token);
    const { result } = yield* mcp.rpc("tools/list");
    yield* interrupt(thread.id);
    return {
      names: (result as { tools: Array<{ name: string }> }).tools.map(({ name }) => name),
      notices: seen.flatMap((event) => (event._tag === "notice" ? [event.text] : [])),
    };
  });

layer(makeTestApp({ vaults: [sharedRoot] }))("project MCP servers", (it) => {
  it.effect("are saved per project: trimmed, each once, ids checked", () =>
    Effect.gen(function* () {
      const project = yield* register("Saving");
      const get = HttpClient.get(serversPath(project.id)).pipe(Effect.flatMap(decode(GetProjectMcpServersResponse)));
      expect((yield* get).serverIds).toEqual([]);

      const refused = yield* saveServers(project.id, ["GitHub", "ok"]);
      expect(refused.status).toBe(400);
      expect(yield* refused.text).toContain('"GitHub" isn\'t an MCP server id');
      expect((yield* get).serverIds).toEqual([]);

      const saved = yield* saveServers(project.id, [" github ", "jira", "github", ""]).pipe(Effect.flatMap(decode(SaveProjectMcpServersResponse)));
      expect(saved.serverIds).toEqual(["github", "jira"]);
      expect((yield* get).serverIds).toEqual(["github", "jira"]);
      expect((yield* saveServers("missing", [])).status).toBe(404);
    }),
  );

  it.effect("give every thread in the project their tools, whatever its agent, and only those threads", () =>
    Effect.gen(function* () {
      yield* addServer("team-tools");
      const project = yield* register("Team");
      const other = yield* register("Other");

      const before = yield* turnTools(project.vaultId, project.id);
      expect(before.names).not.toContain("team-tools__echo");

      yield* saveServers(project.id, ["team-tools", "not-added"]).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
      const inProject = yield* turnTools(project.vaultId, project.id);
      expect(inProject.names).toContain("team-tools__echo");
      expect(inProject.notices.join(" ")).toContain('The project lists the MCP server "not-added"');

      expect((yield* turnTools(other.vaultId, other.id)).names).not.toContain("team-tools__echo");
      expect((yield* turnTools(project.vaultId, null)).names).not.toContain("team-tools__echo");
    }),
  );
});
