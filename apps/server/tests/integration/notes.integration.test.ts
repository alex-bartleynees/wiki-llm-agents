import { expect, layer } from "@effect/vitest";
import { GetNoteResponse } from "@wiki-agents/contracts/notes/get-note/response";
import { GetTreeResponse } from "@wiki-agents/contracts/notes/get-tree/response";
import { RegisterVaultResponse } from "@wiki-agents/contracts/vaults/register-vault/response";
import { Context, Effect, Layer, type Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { TestApp } from "./infrastructure/test-app.js";
import { makeTestVault } from "./infrastructure/test-vault.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A small vault plus a registered vault id, shared by every test in this file. */
class Fixture extends Context.Service<Fixture, { readonly vaultId: string }>()("Fixture") {}

const FixtureLive = Layer.effect(
  Fixture,
  Effect.gen(function* () {
    const vault = yield* makeTestVault({
      files: {
        "index.md": "---\ntags: [home]\n---\n# Home\n\nSee [[Plan]] and [[Missing]].\n\n![[diagram.png|300]]",
        "Projects/Plan.md": "# Plan\n\n## Next steps\n\nBack to [[index|home]].",
        "Projects/Effect 4.1.md": "dotted name",
        "assets/diagram.png": PNG,
        "assets/drawing.svg": '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        "notes.txt": "plain",
        "data/listings.json": '{"rent": 600}',
        "Reports/Spending.html": "<!doctype html><script>document.title = 'ran'</script><p>Report</p>",
        ".obsidian/app.json": "{}",
        ".git/config": "[core]",
        ".trash/old.md": "deleted",
        "index.sync-conflict-20260803-092856-ZMVBMAF.md": "conflict",
      },
      symlinks: { "escape.md": "outside/secret.md", "escape-dir": "outside" },
    });
    const response = yield* HttpClient.execute(
      HttpClientRequest.post("/api/vaults").pipe(HttpClientRequest.bodyJsonUnsafe({ rootPath: vault.root })),
    );
    const { vault: registered } = yield* HttpClientResponse.schemaBodyJson(RegisterVaultResponse)(response);
    return { vaultId: registered.id };
  }),
);

const get = (path: string) => HttpClient.get(path);

const getJson = <A>(path: string, schema: Schema.ConstraintDecoder<A>) =>
  get(path).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk), Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)));

layer(FixtureLive.pipe(Layer.provideMerge(TestApp)))("notes", (it) => {
  it.effect("lists the vault's visible files, sorted, without ignored names or escaping symlinks", () =>
    Effect.gen(function* () {
      const { vaultId } = yield* Fixture;
      const tree = yield* getJson(`/api/vaults/${vaultId}/tree`, GetTreeResponse);
      expect(tree.entries).toEqual([
        { path: "assets/diagram.png", kind: "file" },
        { path: "assets/drawing.svg", kind: "file" },
        { path: "data/listings.json", kind: "json" },
        { path: "index.md", kind: "note" },
        { path: "notes.txt", kind: "file" },
        { path: "Projects/Effect 4.1.md", kind: "note" },
        { path: "Projects/Plan.md", kind: "note" },
        { path: "Reports/Spending.html", kind: "page" },
      ]);
    }),
  );

  it.effect("renders a note with resolved and unresolved links, embeds, and frontmatter tags", () =>
    Effect.gen(function* () {
      const { vaultId } = yield* Fixture;
      const note = yield* getJson(`/api/vaults/${vaultId}/note?path=index.md`, GetNoteResponse);
      expect(note).toMatchObject({ vaultId, path: "index.md", title: "index", tags: ["home"] });
      expect(note.html).toContain(`<a href="/vaults/${vaultId}?note=Projects/Plan.md" class="wikilink">Plan</a>`);
      expect(note.html).toContain('<span class="wikilink unresolved" title="Unresolved: Missing">Missing</span>');
      expect(note.html).toContain(
        `<img src="/api/vaults/${vaultId}/files?path=assets/diagram.png" alt="diagram.png" class="embed" width="300">`,
      );
      expect(note.links).toEqual([
        { kind: "wikilink", target: "Plan", path: "Projects/Plan.md" },
        { kind: "wikilink", target: "Missing", path: null },
        { kind: "embed", target: "diagram.png", path: "assets/diagram.png" },
      ]);
    }),
  );

  it.effect("opens notes in folders and with dots in their names", () =>
    Effect.gen(function* () {
      const { vaultId } = yield* Fixture;
      const plan = yield* getJson(`/api/vaults/${vaultId}/note?path=Projects%2FPlan.md`, GetNoteResponse);
      expect(plan.html).toContain('<h2 id="next-steps">Next steps</h2>');
      expect(plan.html).toContain(`<a href="/vaults/${vaultId}?note=index.md" class="wikilink">home</a>`);
      const dotted = yield* getJson(`/api/vaults/${vaultId}/note?path=Projects%2FEffect%204.1.md`, GetNoteResponse);
      expect(dotted.title).toBe("Effect 4.1");
    }),
  );

  it.effect.each([
    ["../outside/secret.md", 400],
    ["escape.md", 400],
    ["escape-dir/secret.md", 400],
    [".trash/old.md", 400],
    ["notes.txt", 400],
    ["missing.md", 404],
  ] as const)("GET note %s → %i", ([path, status]) =>
    Effect.gen(function* () {
      const { vaultId } = yield* Fixture;
      const response = yield* get(`/api/vaults/${vaultId}/note?path=${encodeURIComponent(path)}`);
      expect(response.status).toBe(status);
    }),
  );

  it.effect("returns 404 for an unknown vault and 400 without a path", () =>
    Effect.gen(function* () {
      const { vaultId } = yield* Fixture;
      expect((yield* get("/api/vaults/nope/tree")).status).toBe(404);
      expect((yield* get("/api/vaults/nope/note?path=index.md")).status).toBe(404);
      expect((yield* get(`/api/vaults/${vaultId}/note`)).status).toBe(400);
    }),
  );

  it.effect("serves embedded images with a locked-down policy", () =>
    Effect.gen(function* () {
      const { vaultId } = yield* Fixture;
      const response = yield* get(`/api/vaults/${vaultId}/files?path=assets%2Fdiagram.png`);
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("image/png");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["content-security-policy"]).toContain("sandbox");
      expect(new Uint8Array(yield* response.arrayBuffer)).toEqual(PNG);
    }),
  );

  it.effect("sandboxes SVGs and sends unknown types as downloads", () =>
    Effect.gen(function* () {
      const { vaultId } = yield* Fixture;
      const svg = yield* get(`/api/vaults/${vaultId}/files?path=assets%2Fdrawing.svg`);
      expect(svg.headers["content-security-policy"]).toContain("default-src 'none'");
      const text = yield* get(`/api/vaults/${vaultId}/files?path=notes.txt`);
      expect(text.headers["content-type"]).toBe("application/octet-stream");
      expect(text.headers["content-disposition"]).toBe("attachment; filename*=UTF-8''notes.txt");
    }),
  );

  it.effect("serves HTML pages in an opaque-origin sandbox that can run scripts but not send data", () =>
    Effect.gen(function* () {
      const { vaultId } = yield* Fixture;
      const response = yield* get(`/api/vaults/${vaultId}/files?path=Reports%2FSpending.html`);
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(response.headers["content-disposition"]).toBe("inline");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      const policy = (response.headers["content-security-policy"] ?? "").split("; ");
      expect(policy[0]).toBe("sandbox allow-scripts");
      expect(policy).toEqual(
        expect.arrayContaining(["default-src 'none'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'", "frame-ancestors 'self'"]),
      );
      expect(policy.join("; ")).not.toMatch(/allow-same-origin|allow-top-navigation|allow-popups|allow-forms/);
      const body = yield* response.text;
      expect(body.startsWith("<!doctype html><script>(function () {")).toBe(true);
      expect(body.endsWith("</script><script>document.title = 'ran'</script><p>Report</p>")).toBe(true);
    }),
  );

  it.effect("serves JSON as inline, script-free JSON", () =>
    Effect.gen(function* () {
      const { vaultId } = yield* Fixture;
      const response = yield* get(`/api/vaults/${vaultId}/files?path=data%2Flistings.json`);
      expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");
      expect(response.headers["content-disposition"]).toBe("inline");
      expect(response.headers["content-security-policy"]?.split("; ")[0]).toBe("sandbox");
      expect(yield* response.json).toEqual({ rent: 600 });
    }),
  );

  it.effect("never lets static files run scripts", () =>
    Effect.gen(function* () {
      const { vaultId } = yield* Fixture;
      for (const path of ["assets%2Fdrawing.svg", "assets%2Fdiagram.png", "data%2Flistings.json", "notes.txt"]) {
        const policy = (yield* get(`/api/vaults/${vaultId}/files?path=${path}`)).headers["content-security-policy"];
        expect(policy?.split("; ")[0]).toBe("sandbox");
        expect(policy).not.toContain("allow-scripts");
      }
    }),
  );

  it.effect("refuses files outside the vault", () =>
    Effect.gen(function* () {
      const { vaultId } = yield* Fixture;
      expect((yield* get(`/api/vaults/${vaultId}/files?path=escape.md`)).status).toBe(400);
      expect((yield* get(`/api/vaults/${vaultId}/files?path=..%2Foutside%2Fsecret.md`)).status).toBe(400);
      expect((yield* get(`/api/vaults/${vaultId}/files?path=.git%2Fconfig`)).status).toBe(400);
    }),
  );
});
