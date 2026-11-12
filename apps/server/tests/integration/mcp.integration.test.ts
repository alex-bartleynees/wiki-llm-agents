import { utimesSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, layer } from "@effect/vitest";
import { ResolveLinksResponse } from "@wiki-agents/contracts/notes/resolve-links/response";
import { Effect, Exit, Option, Scope } from "effect";
import { TestClock } from "effect/testing";
import { McpTokens } from "../../src/features/mcp/tokens.js";
import { VAULT_TOOL_NAMES } from "../../src/features/mcp/toolkit.js";
import { VaultTools } from "../../src/features/mcp/vault-tools.js";
import { KEYWORD_ONLY } from "../../src/features/mcp/tools/vault-search/tool.js";
import { NO_ATTRIBUTION } from "../../src/features/mcp/tools/vault-recent-changes/tool.js";
import { mcpSession, postMcp, tokenFor } from "./infrastructure/mcp.js";
import { TestApp } from "./infrastructure/test-app.js";
import { decode, getThread, isTag, newThread, newVaultWith, post, sendOk, watch } from "./infrastructure/threads.js";

const widgets = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`Widgets/W${String(index + 1).padStart(2, "0")}.md`, "# Widget\n\nA widget."]));

const FILES = {
  "Projects/Coffee Plan.md": "---\ntags: [project/coffee]\n---\n# Coffee Plan\n\n## Beans\n\nWe buy Ethiopian beans. See [[Brewing]].\n\n## Budget\n\nAbout fifty dollars.\n",
  "Notes/Brewing.md": "# Brewing\n\nPour-over with a V60, ground in [[Grinders|the grinder]].\n",
  "Notes/Grinders.md": "# Grinders\n\nA burr grinder.\n",
  "Notes/Tea.md": "# Tea\n\nSencha, unlike the [[Coffee Plan]].\n",
  "A/Plan.md": "# Plan A\n",
  "B/Plan.md": "# Plan B\n",
  ...widgets,
};

/** A vault with FILES, a replay thread in it, and an MCP session with that thread's token. */
const setUp = Effect.gen(function* () {
  const vault = yield* newVaultWith(FILES);
  const thread = yield* newThread(vault.id);
  const { token } = yield* tokenFor(thread.id, vault.id);
  return { vault, thread, token, mcp: yield* mcpSession(token) };
});

interface Search {
  readonly results: ReadonlyArray<{ readonly path: string; readonly title: string; readonly snippet: string; readonly tags: ReadonlyArray<string> }>;
  readonly linked: ReadonlyArray<{ readonly path: string; readonly hop: number; readonly via: ReadonlyArray<string> }>;
  readonly notices: ReadonlyArray<string>;
}

layer(TestApp)("vault MCP server", (it) => {
  describe("authentication", () => {
    const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } };

    it.effect("refuses requests without a live thread token", () =>
      Effect.gen(function* () {
        const { token } = yield* setUp;
        const none = yield* postMcp(initialize, {});
        expect(none.status).toBe(401);
        expect(none.headers["www-authenticate"]).toMatch(/^Bearer/);
        expect((yield* postMcp(initialize, { authorization: "Bearer not-a-token" })).status).toBe(401);
        expect((yield* postMcp(initialize, { authorization: `Basic ${token}` })).status).toBe(401);
        expect((yield* postMcp(initialize, { authorization: `Bearer ${token}` })).status).toBe(200);
      }),
    );

    it.effect("refuses a token once it has expired or been revoked, never echoing it", () =>
      Effect.gen(function* () {
        const { vault, thread, token } = yield* setUp;
        yield* TestClock.adjust("5 hours");
        const expired = yield* postMcp(initialize, { authorization: `Bearer ${token}` });
        expect(expired.status).toBe(401);
        expect(yield* expired.text).not.toContain(token);

        const fresh = yield* tokenFor(thread.id, vault.id);
        yield* (yield* McpTokens).revoke(fresh.token);
        expect((yield* postMcp(initialize, { authorization: `Bearer ${fresh.token}` })).status).toBe(401);
      }),
    );
  });

  it.effect("gives a thread a new token before its old one expires, and revokes it when the thread's actor lets go", () =>
    Effect.gen(function* () {
      const vault = yield* newVaultWith(FILES);
      const thread = yield* newThread(vault.id);
      const tokens = yield* McpTokens;
      const scope = yield* Scope.make();
      const access = yield* (yield* VaultTools).open({ threadId: thread.id, vaultId: vault.id }).pipe(Scope.provide(scope));
      const first = yield* access.current;
      expect(first.name).toBe(`wiki-agents-${thread.id}`);
      expect(first.url).toMatch(/^http:\/\/(127\.0\.0\.1|\[::1\]):\d+\/mcp$/);
      expect((yield* access.current).token).toBe(first.token);

      // Halfway to expiry, the next turn gets a new token and the old one stops working.
      yield* TestClock.adjust("2 hours");
      const second = yield* access.current;
      expect(second.token).not.toBe(first.token);
      expect(Option.isNone(yield* tokens.verify(first.token))).toBe(true);
      expect(yield* tokens.verify(second.token)).toEqual(Option.some({ threadId: thread.id, vaultId: vault.id }));

      yield* Scope.close(scope, Exit.void);
      expect(Option.isNone(yield* tokens.verify(second.token))).toBe(true);
    }),
  );

  it.effect("lists the vault tools, each with strict arguments and marked read-only", () =>
    Effect.gen(function* () {
      const { mcp } = yield* setUp;
      const { result } = yield* mcp.rpc("tools/list");
      const tools = (result as { tools: ReadonlyArray<{ name: string; inputSchema: { additionalProperties?: boolean }; annotations: { readOnlyHint: boolean } }> }).tools;
      expect(tools.map((tool) => tool.name)).toEqual(VAULT_TOOL_NAMES);
      expect(VAULT_TOOL_NAMES).toEqual([
        "vault_search",
        "vault_note_info",
        "vault_backlinks",
        "vault_resolve_link",
        "vault_open_note",
        "vault_recent_changes",
        "vault_status",
        "vault_read_note",
        "vault_related",
        "project_ignored_files",
      ]);
      for (const tool of tools) {
        expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
        expect(tool.annotations.readOnlyHint, tool.name).toBe(true);
      }
    }),
  );

  it.effect("rejects unknown arguments and out-of-range values with a message naming them", () =>
    Effect.gen(function* () {
      const { mcp } = yield* setUp;
      expect(yield* mcp.callError("vault_search", { query: "beans", top: 3 })).toMatch(/excess property[\s\S]*"top"/);
      expect(yield* mcp.callError("vault_search", { query: "beans", limit: 0 })).toMatch(/limit/);
      expect(yield* mcp.callError("vault_search", { query: "beans", limit: 51 })).toMatch(/limit/);
      expect(yield* mcp.callError("vault_search", { query: "beans", hops: 3 })).toMatch(/hops/);
      expect(yield* mcp.callError("vault_search", {})).toMatch(/query/);
      expect(yield* mcp.callError("vault_status", { verbose: true })).toMatch(/verbose/);
    }),
  );

  describe("vault_search", () => {
    it.effect("finds notes by their words, with a plain-text snippet, and says it is keyword-only", () =>
      Effect.gen(function* () {
        const { mcp } = yield* setUp;
        const found = yield* mcp.result<Search>("vault_search", { query: "ethiopian" });
        expect(found.results.map((hit) => hit.path)).toEqual(["Projects/Coffee Plan.md"]);
        expect(found.results[0]).toMatchObject({ title: "Coffee Plan", tags: ["project/coffee"] });
        expect(found.results[0]!.snippet).toContain("Ethiopian beans");
        expect(found.linked).toEqual([]);
        expect(found.notices).toEqual([KEYWORD_ONLY]);
      }),
    );

    it.effect("says when results were cut short, and how to get more", () =>
      Effect.gen(function* () {
        const { mcp } = yield* setUp;
        const found = yield* mcp.result<Search>("vault_search", { query: "widget", limit: 5 });
        expect(found.results).toHaveLength(5);
        expect(found.notices[0]).toMatch(/best 5 matches; there are more\. Raise `limit` \(up to 50\)/);
        const all = yield* mcp.result<Search>("vault_search", { query: "widget" });
        expect(all.results).toHaveLength(10);
        expect(all.notices[0]).toMatch(/best 10 matches/);
      }),
    );

    it.effect("filters by tag, and says when the filter left nothing", () =>
      Effect.gen(function* () {
        const { mcp } = yield* setUp;
        expect((yield* mcp.result<Search>("vault_search", { query: "beans", tags: ["project"] })).results).toHaveLength(1);
        const none = yield* mcp.result<Search>("vault_search", { query: "beans", tags: ["area"] });
        expect(none.results).toEqual([]);
        expect(none.notices[0]).toMatch(/tag filter \(area\)/);
      }),
    );

    it.effect("follows links both ways with hops, saying which result each came from", () =>
      Effect.gen(function* () {
        const { mcp } = yield* setUp;
        const one = yield* mcp.result<Search>("vault_search", { query: "ethiopian", hops: 1 });
        expect(one.linked).toEqual([
          { path: "Notes/Brewing.md", title: "Brewing", tags: [], hop: 1, via: ["Projects/Coffee Plan.md"] },
          { path: "Notes/Tea.md", title: "Tea", tags: [], hop: 1, via: ["Projects/Coffee Plan.md"] },
        ]);
        const two = yield* mcp.result<Search>("vault_search", { query: "ethiopian", hops: 2 });
        expect(two.linked.at(-1)).toMatchObject({ path: "Notes/Grinders.md", hop: 2, via: ["Notes/Brewing.md"] });
      }),
    );

    it.effect("searches only the calling thread's vault", () =>
      Effect.gen(function* () {
        const { mcp } = yield* setUp;
        yield* newVaultWith({ "Elsewhere.md": "# Elsewhere\n\nZanzibar." });
        expect((yield* mcp.result<Search>("vault_search", { query: "zanzibar" })).results).toEqual([]);
      }),
    );
  });

  it.effect("vault_backlinks lists notes linking to a file", () =>
    Effect.gen(function* () {
      const { mcp } = yield* setUp;
      expect(yield* mcp.result("vault_backlinks", { path: "Projects/Coffee Plan.md" })).toEqual({
        path: "Projects/Coffee Plan.md",
        total: 1,
        backlinks: [{ path: "Notes/Tea.md", title: "Tea" }],
        notices: [],
      });
      const capped = yield* mcp.result<{ backlinks: ReadonlyArray<unknown>; notices: ReadonlyArray<string> }>("vault_backlinks", {
        path: "Notes/Grinders.md",
        limit: 1,
      });
      expect(capped.backlinks).toHaveLength(1);
      const outside = yield* mcp.call("vault_backlinks", { path: "../secret.md" });
      expect(outside.isError).toBe(true);
    }),
  );

  it.effect("vault_resolve_link resolves like the vault does, and says when a name is ambiguous", () =>
    Effect.gen(function* () {
      const { mcp } = yield* setUp;
      expect(yield* mcp.result("vault_resolve_link", { link: "[[Coffee Plan#Budget|money]]" })).toEqual({
        target: "Coffee Plan",
        heading: "Budget",
        path: "Projects/Coffee Plan.md",
        title: "Coffee Plan",
        alternatives: [],
        notices: ["The heading isn't checked here; vault_note_info lists the note's headings."],
      });
      const ambiguous = yield* mcp.result<{ path: string; alternatives: ReadonlyArray<string>; notices: ReadonlyArray<string> }>("vault_resolve_link", {
        link: "Plan",
        from: "B/Other.md",
      });
      expect(ambiguous.path).toBe("B/Plan.md");
      expect(ambiguous.alternatives).toEqual(["A/Plan.md"]);
      expect(ambiguous.notices[0]).toMatch(/ambiguous: 2 files match/);
      const missing = yield* mcp.result<{ path: null; notices: ReadonlyArray<string> }>("vault_resolve_link", { link: "Nowhere" });
      expect(missing.path).toBeNull();
      expect(missing.notices[0]).toMatch(/vault_search/);
    }),
  );

  it.effect("vault_note_info gives headings to cite, links, and the backlink count", () =>
    Effect.gen(function* () {
      const { mcp } = yield* setUp;
      expect(yield* mcp.result("vault_note_info", { path: "Projects/Coffee Plan.md" })).toMatchObject({
        path: "Projects/Coffee Plan.md",
        title: "Coffee Plan",
        tags: ["project/coffee"],
        frontmatter: { tags: ["project/coffee"] },
        headings: [
          { depth: 1, text: "Coffee Plan", cite: "[[Projects/Coffee Plan#Coffee Plan]]" },
          { depth: 2, text: "Beans", cite: "[[Projects/Coffee Plan#Beans]]" },
          { depth: 2, text: "Budget", cite: "[[Projects/Coffee Plan#Budget]]" },
        ],
        links: [{ target: "Brewing", path: "Notes/Brewing.md", kind: "wikilink" }],
        backlinks: 1,
        notices: [],
      });
      const missing = yield* mcp.call("vault_note_info", { path: "Projects/Nope.md" });
      expect(missing).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringMatching(/no note at "Projects\/Nope.md"/) }] });
    }),
  );

  it.effect("vault_recent_changes lists files newest first and says who changed them isn't known", () =>
    Effect.gen(function* () {
      const vault = yield* newVaultWith({ "old.md": "# Old", "new.md": "# New", "middle.md": "# Middle" });
      const day = 86_400;
      utimesSync(join(vault.rootPath, "old.md"), 10 * day, 10 * day);
      utimesSync(join(vault.rootPath, "middle.md"), 19 * day, 19 * day);
      utimesSync(join(vault.rootPath, "new.md"), 20 * day, 20 * day);
      yield* post(`/api/vaults/${vault.id}/rebuild-index`, {});
      yield* TestClock.setTime(20 * day * 1000);
      const thread = yield* newThread(vault.id);
      const mcp = yield* mcpSession((yield* tokenFor(thread.id, vault.id)).token);

      const recent = yield* mcp.result<{ changes: ReadonlyArray<{ path: string; title: string }>; notices: ReadonlyArray<string> }>(
        "vault_recent_changes",
        { days: 3 },
      );
      expect(recent.changes.map((change) => change.path)).toEqual(["new.md", "middle.md"]);
      expect(recent.notices).toEqual([NO_ATTRIBUTION]);
      const one = yield* mcp.result<{ changes: ReadonlyArray<unknown>; notices: ReadonlyArray<string> }>("vault_recent_changes", { days: 30, limit: 1 });
      expect(one.changes).toHaveLength(1);
      expect(one.notices[0]).toMatch(/Showing the 1 most recent/);
    }),
  );

  it.effect("vault_status names the vault, its index, the tools, and what is unavailable", () =>
    Effect.gen(function* () {
      const { mcp, vault } = yield* setUp;
      const status = yield* mcp.result<{ vault: unknown; index: unknown; tools: unknown; unavailable: ReadonlyArray<{ feature: string }> }>("vault_status");
      expect(status.vault).toEqual({ name: vault.name, path: vault.rootPath });
      expect(status.index).toEqual({ notes: Object.keys(FILES).length, files: Object.keys(FILES).length });
      expect(status.tools).toEqual(VAULT_TOOL_NAMES);
      expect(status.unavailable.map((item) => item.feature)).toContain("semantic search");
    }),
  );

  describe("vault_open_note", () => {
    it.effect("opens a note at a heading in the thread's running turn", () =>
      Effect.gen(function* () {
        const { vault, thread, mcp } = yield* setUp;
        const events = yield* watch(thread.id);
        // The replay's question keeps the turn open until answered.
        const turnId = yield* sendOk(thread.id, "Ask me a question");
        yield* events.until(isTag("request.opened"));

        expect(yield* mcp.result("vault_open_note", { path: "Projects/Coffee Plan.md", heading: "budget" })).toEqual({
          path: "Projects/Coffee Plan.md",
          title: "Coffee Plan",
          heading: "Budget",
          notices: [],
        });
        const missing = yield* mcp.result<{ heading: null; notices: ReadonlyArray<string> }>("vault_open_note", { path: "Notes/Tea.md", heading: "Oolong" });
        expect(missing.heading).toBeNull();
        expect(missing.notices[0]).toMatch(/no heading "Oolong", so it opened at the top. Its headings: Tea/);

        const opened = (yield* getThread(thread.id)).events.map((stored) => stored.event).filter(isTag("note.opened"));
        expect(opened).toEqual([
          {
            _tag: "note.opened",
            turnId,
            path: "Projects/Coffee Plan.md",
            title: "Coffee Plan",
            heading: "Budget",
            href: `/vaults/${vault.id}?note=Projects/Coffee%20Plan.md#budget`,
          },
          { _tag: "note.opened", turnId, path: "Notes/Tea.md", title: "Tea", heading: null, href: `/vaults/${vault.id}?note=Notes/Tea.md` },
        ]);
      }),
    );

    it.effect("fails outside a turn, and for files that aren't notes", () =>
      Effect.gen(function* () {
        const { mcp } = yield* setUp;
        expect(yield* mcp.call("vault_open_note", { path: "Notes/Tea.md" })).toMatchObject({
          isError: true,
          content: [{ text: "Notes can only be opened during a turn." }],
        });
        expect((yield* mcp.call("vault_open_note", { path: "Notes/Missing.md" })).isError).toBe(true);
        expect((yield* mcp.call("vault_open_note", { path: "image.png" })).isError).toBe(true);
      }),
    );
  });

  it.effect("POST /api/vaults/:id/resolve-links resolves citations to app links at their heading", () =>
    Effect.gen(function* () {
      const vault = yield* newVaultWith(FILES);
      const response = yield* post(`/api/vaults/${vault.id}/resolve-links`, {
        links: [{ link: "Projects/Coffee Plan#Beans" }, { link: "[[Tea]]" }, { link: "Gone#Away" }],
      }).pipe(Effect.flatMap(decode(ResolveLinksResponse)));
      expect(response.links.map(({ path, title, heading, href }) => ({ path, title, heading, href }))).toEqual([
        { path: "Projects/Coffee Plan.md", title: "Coffee Plan", heading: "Beans", href: `/vaults/${vault.id}?note=Projects/Coffee%20Plan.md#beans` },
        { path: "Notes/Tea.md", title: "Tea", heading: null, href: `/vaults/${vault.id}?note=Notes/Tea.md` },
        { path: null, title: null, heading: "Away", href: null },
      ]);
      const tooMany = yield* post(`/api/vaults/${vault.id}/resolve-links`, { links: Array.from({ length: 101 }, () => ({ link: "Tea" })) });
      expect(tooMany.status).toBe(400);
      expect((yield* post("/api/vaults/nope/resolve-links", { links: [] })).status).toBe(404);
    }),
  );
});
