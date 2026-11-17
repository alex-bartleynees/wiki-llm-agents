import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, layer } from "@effect/vitest";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import type { McpServerInput } from "@wiki-agents/contracts/mcp-servers/model";
import { DeleteSecretResponse } from "@wiki-agents/contracts/secrets/delete-secret/response";
import { ListSecretsResponse } from "@wiki-agents/contracts/secrets/list-secrets/response";
import { SetSecretResponse } from "@wiki-agents/contracts/secrets/set-secret/response";
import { Effect, Layer } from "effect";
import { HttpClient, HttpClientRequest, HttpServer } from "effect/http";
import { parseDeclaredSecrets } from "../../src/features/secrets/declared.js";
import { SecretStore } from "../../src/features/secrets/secret-store.js";
import { makeTestApp, makeTestSecrets } from "./infrastructure/test-app.js";
import { afterAll } from "vitest";
import { decode } from "./infrastructure/threads.js";

/** Files declared like `WIKI_AGENTS_SECRET_FILES`, made before the app starts. */
const declaredDir = mkdtempSync(join(tmpdir(), "wiki-agents-declared-"));
writeFileSync(join(declaredDir, "jira"), "jira-token\n");
afterAll(() => rmSync(declaredDir, { recursive: true, force: true }));
const declared = parseDeclaredSecrets(`jira=${join(declaredDir, "jira")},gone=${join(declaredDir, "missing")},Bad Name=/x`);

let root = "";
const secrets = makeTestSecrets({ declared, onRoot: (dir) => (root = dir) });
const secretsFile = () => join(root, "data", "secrets.enc");
const keyFile = () => join(root, "state", "secrets.key");

const list = HttpClient.get("/api/secrets").pipe(Effect.flatMap(decode(ListSecretsResponse)));
const set = (name: string, body: unknown) => HttpClient.execute(HttpClientRequest.put(`/api/secrets/${name}`).pipe(HttpClientRequest.bodyJsonUnsafe(body)));
const setOk = (name: string, value: string, expiresAt: number | null = null) => set(name, { value, expiresAt }).pipe(Effect.flatMap(decode(SetSecretResponse)));
const del = (name: string, force = false) => HttpClient.execute(HttpClientRequest.delete(`/api/secrets/${name}${force ? "?force=true" : ""}`));
const saveServer = (id: string, server: McpServerInput) =>
  HttpClient.execute(HttpClientRequest.put(`/api/mcp-servers/${id}`).pipe(HttpClientRequest.bodyJsonUnsafe({ server, baseHash: null })));

const GITHUB: McpServerInput = {
  title: "GitHub",
  transport: { type: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer ${secret:github}" } },
  scope: "app",
  default: false,
  access: null,
};

layer(makeTestApp({ secrets }))("secrets", (it) => {
  it.effect("lists the declared secrets before anything is stored, with the entries it couldn't use", () =>
    Effect.gen(function* () {
      const listed = yield* list;
      expect(listed.store).toEqual({ state: "empty", keySource: null, problem: null });
      expect(listed.secrets).toEqual([
        { name: "gone", source: "declared", createdAt: null, expiresAt: null, available: false, problem: expect.stringContaining("missing"), usedBy: [] },
        { name: "jira", source: "declared", createdAt: null, expiresAt: null, available: true, problem: null, usedBy: [] },
      ]);
      expect(listed.problems).toEqual([expect.stringContaining('"Bad Name=/x"')]);
    }),
  );

  it.effect("stores a value encrypted and never returns it", () =>
    Effect.gen(function* () {
      expect((yield* saveServer("github", GITHUB)).status).toBe(200);
      const { secret } = yield* setOk("github", "ghp_very_secret_token", 1_800_000_000_000);
      expect(secret).toEqual({ name: "github", source: "stored", createdAt: expect.any(Number), expiresAt: 1_800_000_000_000, available: true, problem: null, usedBy: ["github"] });

      const listed = yield* list;
      expect(listed.store).toEqual({ state: "ready", keySource: "file", problem: null });
      expect(listed.secrets.map((entry) => entry.name)).toEqual(["github", "gone", "jira"]);
      expect(JSON.stringify(listed)).not.toContain("ghp_very_secret_token");

      const text = readFileSync(secretsFile(), "utf8");
      expect(text).not.toContain("ghp_very_secret_token");
      expect(JSON.parse(text)).toMatchObject({ version: 1, kek: { source: "file" }, secrets: { github: { expiresAt: 1_800_000_000_000 } } });
      expect(statSync(secretsFile()).mode & 0o777).toBe(0o600);
      expect(statSync(join(root, "data")).mode & 0o777).toBe(0o700);
      expect(statSync(keyFile()).mode & 0o777).toBe(0o600);

      // Replacing keeps one entry, with a new ciphertext.
      const before = JSON.parse(text).secrets.github.ciphertext;
      yield* setOk("github", "ghp_replaced");
      expect(JSON.parse(readFileSync(secretsFile(), "utf8")).secrets.github.ciphertext).not.toBe(before);
    }),
  );

  it.effect("refuses a bad name or value, and a name declared in the service's configuration", () =>
    Effect.gen(function* () {
      const refused = (name: string, body: unknown, status: number) =>
        Effect.gen(function* () {
          const response = yield* set(name, body);
          expect(response.status).toBe(status);
          return yield* response.text;
        });
      expect(yield* refused("Not-Valid", { value: "x", expiresAt: null }, 422)).toMatch(/^name: /);
      expect(yield* refused("empty", { value: "", expiresAt: null }, 422)).toMatch(/^value: /);
      expect(yield* refused("huge", { value: "x".repeat(17 * 1024), expiresAt: null }, 422)).toMatch(/^value: Longer than 16 KiB/);
      expect(yield* refused("dated", { value: "x", expiresAt: -1 }, 422)).toBe("expiresAt: Not a date.");
      expect(yield* refused("jira", { value: "x", expiresAt: null }, 409)).toMatch(/declared in the service's configuration/);
      expect(yield* refused("shape", { value: 42 }, 400)).toBe("Invalid request");
      expect((yield* list).secrets.map((entry) => entry.name)).toEqual(["github", "gone", "jira"]);
    }),
  );

  it.effect("deletes only after the servers using it are changed, or when forced", () =>
    Effect.gen(function* () {
      const inUse = yield* del("github");
      expect(inUse.status).toBe(409);
      expect(yield* inUse.text).toMatch(/^Still used by github\./);
      const forced = yield* del("github", true).pipe(Effect.flatMap(decode(DeleteSecretResponse)));
      expect(forced).toEqual({ stillUsedBy: ["github"] });
      expect((yield* list).secrets.map((entry) => entry.name)).toEqual(["gone", "jira"]);
      expect((yield* del("github", true)).status).toBe(404);
      expect((yield* del("never")).status).toBe(404);
      const declaredOne = yield* del("jira");
      expect(declaredOne.status).toBe(409);
      expect(yield* declaredOne.text).toMatch(/declared in the service's configuration .*; remove it there/);
      // The file stays, keyed, so the next secret reuses the key.
      expect((yield* list).store).toEqual({ state: "empty", keySource: "file", problem: null });
    }),
  );

  it.effect("says when the key is gone, and lets you delete and start again", () =>
    Effect.gen(function* () {
      yield* setOk("notes", "token-1");
      rmSync(keyFile());
      const listed = yield* list;
      expect(listed.store).toMatchObject({ state: "unreadable", keySource: "file", problem: expect.stringContaining("key for the stored secrets is missing") });
      expect(listed.secrets.find((entry) => entry.name === "notes")).toMatchObject({ available: false });
      const blocked = yield* set("other", { value: "token-2", expiresAt: null });
      expect(blocked.status).toBe(409);
      expect(yield* blocked.text).toMatch(/Delete the stored secrets and enter them again/);

      // Deleting needs no key; with nothing left, the next secret gets a new key.
      expect((yield* del("notes")).status).toBe(200);
      yield* setOk("other", "token-2");
      expect((yield* list).store.state).toBe("ready");
    }),
  );

  it.effect("serves secrets only to requests addressed to localhost or the tailnet", () =>
    Effect.gen(function* () {
      const port = Number(new URL(HttpServer.formatAddress((yield* HttpServer.HttpServer).address)).port);
      // As a page on another domain pointed at 127.0.0.1 would send it. fetch won't set Host, so node:http.
      const withHost = (method: string, path: string, host: string, body?: string) =>
        Effect.callback<{ readonly status: number; readonly text: string }>((resume) => {
          const request = httpRequest({ host: "127.0.0.1", port, method, path, headers: { host, "content-type": "application/json" } }, (response) => {
            let text = "";
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => (text += chunk));
            response.on("end", () => resume(Effect.succeed({ status: response.statusCode ?? 0, text })));
          });
          request.on("error", (error) => resume(Effect.die(error)));
          request.end(body);
        });
      expect(yield* withHost("GET", "/api/secrets", "evil.example.com")).toEqual({ status: 403, text: "Secrets are served on localhost and the tailnet only" });
      expect((yield* withHost("PUT", "/api/secrets/x", `evil.example.com:${port}`, JSON.stringify({ value: "v", expiresAt: null }))).status).toBe(403);
      expect((yield* withHost("DELETE", "/api/secrets/other?force=true", "localhost.evil.example.com")).status).toBe(403);
      expect((yield* withHost("GET", "/api/secrets", `localhost:${port}`)).status).toBe(200);
      expect((yield* list).secrets.map((entry) => entry.name)).toEqual(["gone", "jira", "other"]);
    }),
  );
});

/** The store alone: `resolve` has no endpoint, as only the gateway reads values. */
const Processes = NodeChildProcessSpawner.layer.pipe(Layer.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)));
let storeRoot = "";
const Store = makeTestSecrets({ declared, onRoot: (dir) => (storeRoot = dir) }).pipe(Layer.provide(Layer.merge(NodeFileSystem.layer, Processes)));

layer(Store)("resolving secrets", (it) => {
  it.effect("gives a stored value and a declared file's value without its last new line", () =>
    Effect.gen(function* () {
      const store = yield* SecretStore;
      yield* store.set({ name: "github", value: "ghp_token\n", expiresAt: null });
      expect(yield* store.resolve("github")).toBe("ghp_token\n");
      expect(yield* store.resolve("jira")).toBe("jira-token");
    }),
  );

  it.effect("fails with a reason that never holds a value", () =>
    Effect.gen(function* () {
      const store = yield* SecretStore;
      const reason = (name: string) => Effect.flip(store.resolve(name)).pipe(Effect.map((error) => error.reason));
      expect(yield* reason("nothing")).toMatch(/There is no secret "nothing"/);
      expect(yield* reason("gone")).toMatch(/can't be read/);

      // A ciphertext moved to another name doesn't open: the name is bound to it.
      const file = join(storeRoot, "data", "secrets.enc");
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      parsed.secrets.copy = parsed.secrets.github;
      writeFileSync(file, JSON.stringify(parsed));
      expect(yield* reason("copy")).toMatch(/is damaged/);

      writeFileSync(file, "not json");
      expect(yield* reason("github")).toMatch(/isn't a secrets file this app wrote/);
      expect(yield* reason("github")).not.toContain("ghp_token");
    }),
  );
});
