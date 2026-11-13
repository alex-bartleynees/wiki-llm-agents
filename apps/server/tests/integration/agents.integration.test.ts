import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { GetAgentResponse } from "@wiki-agents/contracts/agents/get-agent/response";
import { ListAgentsResponse } from "@wiki-agents/contracts/agents/list-agents/response";
import { CreateThreadResponse } from "@wiki-agents/contracts/threads/create-thread/response";
import { SetAgentResponse } from "@wiki-agents/contracts/threads/set-agent/response";
import { Effect, Layer, PubSub } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { AgentCatalog } from "../../src/features/agents/catalog.js";
import { makeAgentCatalog } from "../../src/features/agents/catalog-live.js";
import { writeConfigFile } from "../../src/features/agents/config-files.js";
import { TestApp } from "./infrastructure/test-app.js";
import { decode, isTag, newVault, post, sendOk, watch } from "./infrastructure/threads.js";

const listAgents = HttpClient.get("/api/agents").pipe(Effect.flatMap(decode(ListAgentsResponse)));

const put = (path: string, body: unknown) => HttpClient.execute(HttpClientRequest.put(path).pipe(HttpClientRequest.bodyJsonUnsafe(body)));

/** Writes an agent file into the app's config directory and reloads. */
const writeAgent = (id: string, text: string) =>
  Effect.gen(function* () {
    const { configDir } = yield* listAgents;
    writeFileSync(join(configDir, "agents", `${id}.md`), text);
    return yield* (yield* AgentCatalog).reload;
  });

const removeAgent = (id: string) =>
  Effect.gen(function* () {
    const { configDir } = yield* listAgents;
    unlinkSync(join(configDir, "agents", `${id}.md`));
    return yield* (yield* AgentCatalog).reload;
  });

layer(TestApp)("agents", (it) => {
  it.effect("starts with the default rules and four agents, and says what each provider enforces", () =>
    Effect.gen(function* () {
      const { agents, rules, problems, configDir } = yield* listAgents;
      expect(agents.map((agent) => agent.name)).toEqual(expect.arrayContaining(["Builder", "Librarian", "Researcher", "Reviewer"]));
      expect(rules).toEqual([{ id: "wiki-llm", path: join(configDir, "rules", "wiki-llm.md") }]);
      expect(problems).toEqual([]);
      const researcher = agents.find((agent) => agent.id === "researcher");
      expect(researcher).toMatchObject({
        path: join(configDir, "agents", "researcher.md"),
        autonomy: { read: "allow", create: "allow", edit: "ask", commands: "deny", web: "allow" },
        sources: ["vault", "web"],
      });
      // The tests run on the replay provider alone, where autonomy doesn't apply.
      expect(researcher?.enforcement).toEqual([{ providerInstanceId: "replay", autonomy: null, notes: [expect.stringMatching(/autonomy doesn.t apply/)] }]);
    }),
  );

  it.effect("returns an agent's instructions, and 404 for one that doesn't exist", () =>
    Effect.gen(function* () {
      const { agent, instructions } = yield* HttpClient.get("/api/agents/reviewer").pipe(Effect.flatMap(decode(GetAgentResponse)));
      expect(agent.name).toBe("Reviewer");
      expect(instructions).toMatch(/^# Reviewer/);
      const missing = yield* HttpClient.get("/api/agents/nobody");
      expect(missing.status).toBe(404);
      expect(yield* missing.text).toBe('There is no agent "nobody".');
    }),
  );

  it.effect("reports a broken file without losing the other agents, and picks up the fix", () =>
    Effect.gen(function* () {
      const broken = yield* writeAgent("broken", "---\nautonomy:\n  edit: sometimes\n---\nGo.");
      expect(broken.agents.map((agent) => agent.id)).not.toContain("broken");
      expect(broken.agents.map((agent) => agent.id)).toContain("researcher");
      const { problems } = yield* listAgents;
      expect(problems).toEqual([{ path: expect.stringMatching(/agents\/broken\.md$/), message: expect.stringMatching(/^autonomy\.edit: /) }]);
      const response = yield* HttpClient.get("/api/agents/broken");
      expect(response.status).toBe(404);
      expect(yield* response.text).toMatch(/^The agent "broken" can't be used: autonomy\.edit: /);

      const fixed = yield* writeAgent("broken", "---\nautonomy:\n  edit: deny\n---\nGo.");
      expect(fixed.problems).toEqual([]);
      expect(fixed.agents.find((agent) => agent.id === "broken")?.autonomy.edit).toBe("deny");
      yield* removeAgent("broken");
    }),
  );

  it.effect("reports a Syncthing conflict copy and keeps the agent it conflicts with", () =>
    Effect.gen(function* () {
      const copy = "researcher.sync-conflict-20261110-120000-ABCDEFG.md";
      const { configDir } = yield* listAgents;
      writeFileSync(join(configDir, "agents", copy), "---\nname: Other researcher\n---\nGo.");
      const config = yield* (yield* AgentCatalog).reload;
      expect(config.agents.filter((agent) => agent.id === "researcher").map((agent) => agent.name)).toEqual(["Researcher"]);
      expect(config.problems).toEqual([
        { path: join(configDir, "agents", copy), message: expect.stringMatching(/^A Syncthing conflict copy of researcher\.md/) },
      ]);
      unlinkSync(join(configDir, "agents", copy));
      expect((yield* (yield* AgentCatalog).reload).problems).toEqual([]);
    }),
  );

  it.effect("creates threads with an agent and switches it", () =>
    Effect.gen(function* () {
      const vault = yield* newVault;
      const { thread } = yield* post(`/api/vaults/${vault.id}/threads`, { agentId: "researcher" }).pipe(Effect.flatMap(decode(CreateThreadResponse)));
      expect(thread).toMatchObject({ agentId: "researcher", providerInstanceId: "replay", model: null });

      const switched = yield* put(`/api/threads/${thread.id}/agent`, { agentId: "reviewer" }).pipe(Effect.flatMap(decode(SetAgentResponse)));
      expect(switched.thread.agentId).toBe("reviewer");
      const cleared = yield* put(`/api/threads/${thread.id}/agent`, { agentId: null }).pipe(Effect.flatMap(decode(SetAgentResponse)));
      expect(cleared.thread.agentId).toBeNull();

      expect((yield* put(`/api/threads/${thread.id}/agent`, { agentId: "nobody" })).status).toBe(400);
      expect((yield* post(`/api/vaults/${vault.id}/threads`, { agentId: "nobody" })).status).toBe(400);
      expect((yield* put("/api/threads/nope/agent", { agentId: null })).status).toBe(404);
    }),
  );

  it.effect("uses the agent's provider unless the request names one", () =>
    Effect.gen(function* () {
      const vault = yield* newVault;
      yield* writeAgent("elsewhere", "---\nprovider: nowhere\n---\nGo.");
      const response = yield* post(`/api/vaults/${vault.id}/threads`, { agentId: "elsewhere" });
      expect(response.status).toBe(400);
      expect(yield* response.text).toBe("Unknown provider");
      const { thread } = yield* post(`/api/vaults/${vault.id}/threads`, { agentId: "elsewhere", providerInstanceId: "replay" }).pipe(
        Effect.flatMap(decode(CreateThreadResponse)),
      );
      expect(thread.providerInstanceId).toBe("replay");
      yield* removeAgent("elsewhere");
    }),
  );

  it.effect("fails a turn whose agent has gone, saying why, and runs again once it is back", () =>
    Effect.gen(function* () {
      const vault = yield* newVault;
      yield* writeAgent("fleeting", "Go.");
      const { thread } = yield* post(`/api/vaults/${vault.id}/threads`, { agentId: "fleeting" }).pipe(Effect.flatMap(decode(CreateThreadResponse)));
      yield* removeAgent("fleeting");

      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, "hello");
      const failed = (yield* events.until(isTag("turn.finished"))).at(-1);
      expect(failed).toMatchObject({ _tag: "turn.finished", outcome: "failed", reason: 'There is no agent "fleeting".' });

      yield* writeAgent("fleeting", "Go.");
      const again = yield* watch(thread.id);
      yield* sendOk(thread.id, "hello");
      expect((yield* again.until(isTag("turn.finished"))).at(-1)).toMatchObject({ outcome: "completed" });
      yield* removeAgent("fleeting");
    }),
  );
});

/** The catalog alone over a temp folder, watched for real (so the real clock). */
const configDir = mkdtempSync(join(tmpdir(), "wiki-agents-watched-"));
const Watched = makeAgentCatalog({ dir: configDir, watch: true }).pipe(
  Layer.provide(NodeFileSystem.layer),
  Layer.merge(Layer.effectDiscard(Effect.addFinalizer(() => Effect.sync(() => rmSync(configDir, { recursive: true, force: true }))))),
);

layer(Watched, { excludeTestServices: true })("agents, watched", (it) => {
  it.effect("seeds an empty folder and reloads when a file changes", () =>
    Effect.gen(function* () {
      const catalog = yield* AgentCatalog;
      expect((yield* catalog.current).agents).toHaveLength(4);
      const loaded = yield* catalog.subscribe;
      writeFileSync(join(configDir, "agents", "scout.md"), "---\nname: Scout\n---\nLook around.");
      while (true) {
        const config = yield* PubSub.take(loaded);
        if (config.agents.some((agent) => agent.name === "Scout")) break;
      }
      expect((yield* catalog.get("scout")).instructions).toBe("Look around.");
    }),
  );

  it.effect("reloads a file the app writes, as it does any other change", () =>
    Effect.gen(function* () {
      const catalog = yield* AgentCatalog;
      const loaded = yield* catalog.subscribe;
      const path = join(configDir, "agents", "writer.md");
      yield* writeConfigFile(path, "---\nname: Writer\n---\nWrite.", null).pipe(Effect.provide(NodeFileSystem.layer));
      while (true) {
        const config = yield* PubSub.take(loaded);
        if (config.agents.some((agent) => agent.name === "Writer")) break;
      }
      // The temporary file it wrote through was never loaded, nor reported.
      expect((yield* catalog.current).problems).toEqual([]);
    }),
  );
});
