import { describe, expect, layer } from "@effect/vitest";
import type { AgentInput, KnowledgeSource } from "@wiki-agents/contracts/agents/model";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { mcpSession, tokenFor } from "./infrastructure/mcp.js";
import { TestApp } from "./infrastructure/test-app.js";
import { isTag, newThread, newVaultWith, sendOk, setAgent, watch } from "./infrastructure/threads.js";

const FILES = {
  "Projects/Coffee.md": "# Coffee\n\nBeans from Ethiopia. See [[Tea]] and [[Private/Coffee money]].\n",
  "Projects/Active/Grinder.md": "# Grinder\n\nA coffee grinder. [[Coffee]]\n",
  "Projects Old/Coffee.md": "# Old coffee\n\nCoffee we used to drink.\n",
  "Notes/Tea.md": "# Tea\n\nNot coffee. [[Coffee]]\n",
  "Private/Coffee money.md": "# Coffee money\n\nWhat coffee costs. [[Coffee]]\n",
};

/** Creates (or replaces) an agent with these sources over the API, as the editor does. */
const agentWith = (id: string, sources: ReadonlyArray<KnowledgeSource>) =>
  Effect.gen(function* () {
    const agent: AgentInput = {
      name: id,
      description: "",
      provider: null,
      model: null,
      sources,
      autonomy: { read: "allow", create: "ask", edit: "ask", commands: "deny", web: "deny" },
      concurrency: 1,
      instructions: "Look things up.",
    };
    const current = yield* HttpClient.get(`/api/agents/${id}`);
    const baseHash = current.status === 200 ? ((yield* current.json) as { hash: string }).hash : null;
    yield* HttpClient.execute(HttpClientRequest.put(`/api/agents/${id}`).pipe(HttpClientRequest.bodyJsonUnsafe({ agent, baseHash }))).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
    );
  });

/** A vault, a thread in it with an agent whose sources are `sources`, and an MCP session for it. */
const setUp = (sources: (vaultName: string) => ReadonlyArray<KnowledgeSource>) =>
  Effect.gen(function* () {
    const vault = yield* newVaultWith(FILES);
    const thread = yield* newThread(vault.id);
    const id = `scoped-${thread.id.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "0")}`;
    yield* agentWith(id, sources(vault.name));
    yield* setAgent(thread.id, id);
    const { token } = yield* tokenFor(thread.id, vault.id);
    return { vault, thread, agentId: id, mcp: yield* mcpSession(token) };
  });

interface Search {
  readonly results: ReadonlyArray<{ readonly path: string }>;
  readonly notices: ReadonlyArray<string>;
}

const paths = (search: Search) => search.results.map((result) => result.path).sort();

layer(TestApp)("vault tools limited by the agent's knowledge sources", (it) => {
  it.effect("reach the whole vault without an agent, with no sources, or with `vault`", () =>
    Effect.gen(function* () {
      for (const sources of [() => [], () => ["vault" as const], (name: string) => [{ vault: name, folders: [] }]]) {
        const { mcp } = yield* setUp(sources);
        expect(paths(yield* mcp.result<Search>("vault_search", { query: "coffee" }))).toEqual([
          "Notes/Tea.md",
          "Private/Coffee money.md",
          "Projects Old/Coffee.md",
          "Projects/Active/Grinder.md",
          "Projects/Coffee.md",
        ]);
      }
    }),
  );

  describe("limited to folders", () => {
    const projects = (name: string): ReadonlyArray<KnowledgeSource> => ["web", { vault: name, folders: ["Projects"] }];

    it.effect("search finds only notes in them, not in a folder sharing the prefix, and says so", () =>
      Effect.gen(function* () {
        const { mcp } = yield* setUp(projects);
        const found = yield* mcp.result<Search>("vault_search", { query: "coffee", hops: 1 });
        expect(paths(found)).toEqual(["Projects/Active/Grinder.md", "Projects/Coffee.md"]);
        expect((found as unknown as { linked: ReadonlyArray<{ path: string }> }).linked).toEqual([]);
        expect(found.notices[0]).toBe("Limited to this agent's folders: Projects.");
      }),
    );

    it.effect("refuses notes outside them, and leaves them out of backlinks, links and recent changes", () =>
      Effect.gen(function* () {
        const { mcp } = yield* setUp(projects);
        const refused = yield* mcp.call("vault_note_info", { path: "Notes/Tea.md" });
        expect(refused.isError).toBe(true);
        expect(refused.content[0]?.text).toBe('"Notes/Tea.md" is outside the folders this agent may use (Projects).');
        expect((yield* mcp.call("vault_backlinks", { path: "Private/Coffee money.md" })).isError).toBe(true);
        expect((yield* mcp.call("vault_related", { path: "Notes/Tea.md" })).isError).toBe(true);

        const backlinks = yield* mcp.result<{ backlinks: ReadonlyArray<{ path: string }> }>("vault_backlinks", { path: "Projects/Coffee.md" });
        expect(backlinks.backlinks.map((backlink) => backlink.path)).toEqual(["Projects/Active/Grinder.md"]);
        const info = yield* mcp.result<{ backlinks: number }>("vault_note_info", { path: "Projects/Coffee.md" });
        expect(info.backlinks).toBe(1);

        const recent = yield* mcp.result<{ changes: ReadonlyArray<{ path: string }> }>("vault_recent_changes", { days: 30 });
        expect(recent.changes.map((change) => change.path).sort()).toEqual(["Projects/Active/Grinder.md", "Projects/Coffee.md"]);

        const link = yield* mcp.result<{ path: string | null }>("vault_resolve_link", { link: "Coffee money" });
        expect(link.path).toBeNull();
        const coffee = yield* mcp.result<{ path: string | null; alternatives: ReadonlyArray<string> }>("vault_resolve_link", { link: "Coffee" });
        expect(coffee).toMatchObject({ path: "Projects/Coffee.md", alternatives: [] });

        const status = yield* mcp.result<{ notices: ReadonlyArray<string>; tools: ReadonlyArray<string> }>("vault_status");
        expect(status.notices).toContain("Limited to this agent's folders: Projects.");
        expect(status.tools).toContain("vault_search");
      }),
    );

    it.effect("refuses reading or opening a note outside them, even mid-turn", () =>
      Effect.gen(function* () {
        const { thread, mcp } = yield* setUp(projects);
        const events = yield* watch(thread.id);
        yield* sendOk(thread.id, "Ask me a question");
        yield* events.until(isTag("request.opened"));
        expect((yield* mcp.call("vault_read_note", { path: "Private/Coffee money.md" })).content[0]?.text).toMatch(/is outside the folders/);
        expect((yield* mcp.call("vault_open_note", { path: "Private/Coffee money.md" })).content[0]?.text).toMatch(/is outside the folders/);
        expect((yield* mcp.result<{ path: string }>("vault_read_note", { path: "Projects/Coffee.md" })).path).toBe("Projects/Coffee.md");
      }),
    );
  });

  it.effect("refuse a vault the sources leave out, saying which sources the agent has; vault_status still answers", () =>
    Effect.gen(function* () {
      const { agentId, mcp } = yield* setUp(() => ["web", { vault: "Somewhere else", folders: [] }]);
      const refused = yield* mcp.call("vault_search", { query: "coffee" });
      expect(refused.isError).toBe(true);
      expect(refused.content[0]?.text).toBe(
        `This vault isn't one of the ${agentId} agent's knowledge sources (web; Somewhere else), so the vault tools can't read it.`,
      );
      const status = yield* mcp.result<{ tools: ReadonlyArray<string>; unavailable: ReadonlyArray<{ feature: string }> }>("vault_status");
      expect(status.tools).toEqual([]);
      expect(status.unavailable.map((entry) => entry.feature)).toContain("every vault tool");
    }),
  );

  it.effect("follow an edit to the agent's sources at the next call", () =>
    Effect.gen(function* () {
      const { agentId, vault, mcp } = yield* setUp(() => ["web"]);
      expect((yield* mcp.call("vault_search", { query: "tea" })).isError).toBe(true);
      yield* agentWith(agentId, [{ vault: vault.name, folders: ["Notes"] }]);
      expect(paths(yield* mcp.result<Search>("vault_search", { query: "tea" }))).toEqual(["Notes/Tea.md"]);
    }),
  );
});
