import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, layer } from "@effect/vitest";
import { DeleteAgentResponse } from "@wiki-agents/contracts/agents/delete-agent/response";
import { DeleteRulesResponse } from "@wiki-agents/contracts/agents/delete-rules/response";
import { GetAgentResponse } from "@wiki-agents/contracts/agents/get-agent/response";
import { GetRulesResponse } from "@wiki-agents/contracts/agents/get-rules/response";
import { ListAgentsResponse } from "@wiki-agents/contracts/agents/list-agents/response";
import type { AgentInput } from "@wiki-agents/contracts/agents/model";
import { SaveAgentResponse } from "@wiki-agents/contracts/agents/save-agent/response";
import { SaveRulesResponse } from "@wiki-agents/contracts/agents/save-rules/response";
import { ListProviderModelsResponse } from "@wiki-agents/contracts/providers/list-provider-models/response";
import { CreateThreadResponse } from "@wiki-agents/contracts/threads/create-thread/response";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { sessionSetup } from "../../src/features/agents/session-setup.js";
import { TestApp } from "./infrastructure/test-app.js";
import { decode, isTag, newVault, post, sendOk, watch } from "./infrastructure/threads.js";

const listAgents = HttpClient.get("/api/agents").pipe(Effect.flatMap(decode(ListAgentsResponse)));
const getAgent = (id: string) => HttpClient.get(`/api/agents/${id}`).pipe(Effect.flatMap(decode(GetAgentResponse)));
const getRules = (id: string) => HttpClient.get(`/api/rules/${id}`).pipe(Effect.flatMap(decode(GetRulesResponse)));

const put = (path: string, body: unknown) => HttpClient.execute(HttpClientRequest.put(path).pipe(HttpClientRequest.bodyJsonUnsafe(body)));
const del = (path: string) => HttpClient.execute(HttpClientRequest.delete(path));

const saveAgent = (id: string, agent: AgentInput, baseHash: string | null) => put(`/api/agents/${id}`, { agent, baseHash });
const saveAgentOk = (id: string, agent: AgentInput, baseHash: string | null) => saveAgent(id, agent, baseHash).pipe(Effect.flatMap(decode(SaveAgentResponse)));

const SCOUT: AgentInput = {
  name: "Scout",
  description: "Looks around.",
  provider: null,
  model: null,
  sources: ["vault"],
  autonomy: { read: "allow", create: "ask", edit: "ask", commands: "deny", web: "allow" },
  instructions: "# Scout\n\nLook around.",
};

layer(TestApp)("editing agents and rules", (it) => {
  it.effect("creates an agent, which is listed and used from the next turn", () =>
    Effect.gen(function* () {
      const saved = yield* saveAgentOk("scout", SCOUT, null);
      expect(saved.agent).toMatchObject({ id: "scout", name: "Scout", sources: ["vault"], autonomy: SCOUT.autonomy });
      expect(saved.instructions).toBe("# Scout\n\nLook around.");
      expect(readFileSync(saved.agent.path, "utf8")).toMatch(/^---\nname: Scout\n/);
      expect((yield* listAgents).agents.map((agent) => agent.id)).toContain("scout");
      expect((yield* getAgent("scout")).hash).toBe(saved.hash);

      const vault = yield* newVault;
      const { thread } = yield* post(`/api/vaults/${vault.id}/threads`, { agentId: "scout" }).pipe(Effect.flatMap(decode(CreateThreadResponse)));
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, "hello");
      expect((yield* events.until(isTag("turn.finished"))).at(-1)).toMatchObject({ outcome: "completed" });
    }),
  );

  it.effect("edits an agent: the next turn gets the new instructions, and comments in the file stay", () =>
    Effect.gen(function* () {
      const before = yield* getAgent("researcher");
      const input: AgentInput = { ...before.agent, instructions: "# Researcher\n\nDig deeper.", autonomy: { ...before.agent.autonomy, edit: "deny" } };
      const saved = yield* saveAgentOk("researcher", input, before.hash);
      expect(saved.hash).not.toBe(before.hash);
      const text = readFileSync(saved.agent.path, "utf8");
      expect(text).toContain("# autonomy levels: allow, ask, deny");
      expect(text).toContain("  edit: deny\n");

      const setup = yield* sessionSetup("researcher", "/nowhere");
      expect(setup.instructions.find((instruction) => instruction.source === "agent")?.text).toMatch(/Dig deeper\.$/);
      expect(setup.autonomy.edit).toBe("deny");
      // The web is a source, so its autonomy is the file's.
      expect(setup.autonomy.web).toBe("allow");

      // Saving the same thing again writes nothing and keeps the hash.
      expect((yield* saveAgentOk("researcher", input, saved.hash)).hash).toBe(saved.hash);
    }),
  );

  it.effect("denies the web to an agent whose sources leave it out", () =>
    Effect.gen(function* () {
      const created = yield* saveAgentOk("homebody", { ...SCOUT, name: "Homebody", sources: ["vault"] }, null);
      expect(created.agent.autonomy.web).toBe("allow");
      expect((yield* sessionSetup("homebody", "/nowhere")).autonomy.web).toBe("deny");
    }),
  );

  it.effect("refuses what the loader would refuse, naming the field, and writes nothing", () =>
    Effect.gen(function* () {
      const refused = (id: string, agent: AgentInput) =>
        Effect.gen(function* () {
          const response = yield* saveAgent(id, agent, null);
          expect(response.status).toBe(422);
          return (yield* response.text).split("\n");
        });
      expect(yield* refused("blank", { ...SCOUT, name: " ", instructions: "" })).toEqual([
        "name: Give the agent a name.",
        "instructions: Write what the agent should do.",
      ]);
      expect(yield* refused("lost", { ...SCOUT, provider: "nowhere" })).toEqual(['provider: There is no provider "nowhere".']);
      expect((yield* refused("escape", { ...SCOUT, sources: [{ vault: "Notes", folders: ["../up"] }] }))[0]).toMatch(/^sources\.0\.folders\.0: /);
      expect((yield* refused("Bad Name", SCOUT))[0]).toMatch(/^id: /);

      const { configDir } = yield* listAgents;
      for (const id of ["blank", "lost", "busy", "escape"]) expect(existsSync(join(configDir, "agents", `${id}.md`))).toBe(false);
      expect((yield* put("/api/agents/scout", { agent: { name: "x" }, baseHash: null })).status).toBe(400);
    }),
  );

  it.effect("refuses to overwrite a file that changed on disk, or to create one that exists", () =>
    Effect.gen(function* () {
      const before = yield* getAgent("reviewer");
      // Another machine (via Syncthing) or a hand edit changes it meanwhile.
      writeFileSync(before.agent.path, readFileSync(before.agent.path, "utf8").replace("changes nothing", "changes little"));
      const stale = yield* saveAgent("reviewer", { ...before.agent, instructions: "Mine." }, before.hash);
      expect(stale.status).toBe(409);
      expect(yield* stale.text).toMatch(/has changed since you opened it/);
      expect(readFileSync(before.agent.path, "utf8")).toContain("changes little");

      expect((yield* saveAgent("reviewer", SCOUT, null)).status).toBe(409);

      // Saving over the disk version, as the conflict view's "Save mine" does.
      const current = yield* getAgent("reviewer");
      expect((yield* saveAgentOk("reviewer", { ...current.agent, instructions: "Mine." }, current.hash)).instructions).toBe("Mine.");
    }),
  );

  it.effect("deletes an agent to the config trash: threads keep it and fail their next turn saying why", () =>
    Effect.gen(function* () {
      const created = yield* saveAgentOk("temp", { ...SCOUT, name: "Temp" }, null);
      const vault = yield* newVault;
      const { thread } = yield* post(`/api/vaults/${vault.id}/threads`, { agentId: "temp" }).pipe(Effect.flatMap(decode(CreateThreadResponse)));

      expect((yield* del(`/api/agents/temp?hash=${"0".repeat(64)}`)).status).toBe(409);
      const { trashPath } = yield* del(`/api/agents/temp?hash=${created.hash}`).pipe(Effect.flatMap(decode(DeleteAgentResponse)));
      const { configDir } = yield* listAgents;
      expect(trashPath).toBe(join(configDir, ".trash", "agents", "temp.md"));
      expect(existsSync(created.agent.path)).toBe(false);
      expect((yield* listAgents).agents.map((agent) => agent.id)).not.toContain("temp");
      expect((yield* del(`/api/agents/temp?hash=${created.hash}`)).status).toBe(404);

      // A second delete of the same name doesn't replace the first in the trash.
      const again = yield* saveAgentOk("temp", { ...SCOUT, name: "Temp" }, null);
      expect((yield* del(`/api/agents/temp?hash=${again.hash}`).pipe(Effect.flatMap(decode(DeleteAgentResponse)))).trashPath).toBe(
        join(configDir, ".trash", "agents", "temp 1.md"),
      );

      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, "hello");
      expect((yield* events.until(isTag("turn.finished"))).at(-1)).toMatchObject({ outcome: "failed", reason: 'There is no agent "temp".' });
    }),
  );

  it.effect("edits, creates and deletes rules files, hash-checked; every agent gets them from the next turn", () =>
    Effect.gen(function* () {
      const rules = yield* getRules("wiki-llm");
      expect(rules.content).toMatch(/^# Wiki-LLM rules/);
      const saved = yield* put("/api/rules/wiki-llm", { content: `${rules.content}\n- Be brief.\n`, baseHash: rules.hash }).pipe(Effect.flatMap(decode(SaveRulesResponse)));
      expect((yield* sessionSetup(null, "/nowhere")).instructions[0]?.text).toMatch(/- Be brief\.$/);

      expect((yield* put("/api/rules/wiki-llm", { content: "Other.", baseHash: rules.hash })).status).toBe(409);
      const empty = yield* put("/api/rules/wiki-llm", { content: "---\ntags: []\n---\n", baseHash: saved.hash });
      expect(empty.status).toBe(422);
      expect(yield* empty.text).toBe("content: The rules file is empty.");

      const style = yield* put("/api/rules/style", { content: "# Style\n\nPlain words.", baseHash: null }).pipe(Effect.flatMap(decode(SaveRulesResponse)));
      expect((yield* listAgents).rules.map((file) => file.id)).toEqual(["style", "wiki-llm"]);
      expect((yield* sessionSetup(null, "/nowhere")).instructions.map((instruction) => instruction.title)).toEqual(["rules/style.md", "rules/wiki-llm.md"]);

      yield* del(`/api/rules/style?hash=${style.hash}`).pipe(Effect.flatMap(decode(DeleteRulesResponse)));
      expect((yield* listAgents).rules.map((file) => file.id)).toEqual(["wiki-llm"]);
      expect((yield* HttpClient.get("/api/rules/style")).status).toBe(404);
      expect((yield* HttpClient.get("/api/rules/..%2Fagents%2Fresearcher")).status).toBe(404);
    }),
  );

  it.effect("lists a provider's models without a thread", () =>
    Effect.gen(function* () {
      const models = yield* HttpClient.get("/api/providers/replay/models").pipe(Effect.flatMap(decode(ListProviderModelsResponse)));
      expect(models).toEqual({ models: [], defaultModel: null });
      expect((yield* HttpClient.get("/api/providers/nowhere/models")).status).toBe(404);
    }),
  );
});
