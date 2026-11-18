import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { afterAll } from "vitest";
import { SecretMaterial } from "../../src/features/secrets/material.js";
import { makeProviderEnvironment } from "../../src/shared/provider-environment.js";
import { makeScriptedProvider } from "./infrastructure/scripted-provider.js";
import { makeTestApp, makeTestSecrets } from "./infrastructure/test-app.js";
import { isTag, newVault, newThread, sendOk, watch } from "./infrastructure/threads.js";

const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "wiki-agents-secret-files-")));
const declared = join(elsewhere, "github");
const referenced = join(elsewhere, "jira-token");
writeFileSync(declared, "declared-value\n");
writeFileSync(referenced, "referenced-value\n");
afterAll(() => rmSync(elsewhere, { recursive: true, force: true }));

let secretsRoot = "";
const provider = makeScriptedProvider();
provider.scripts.set("*", () => Effect.succeed([]));

const VARIABLE = "TEST_JIRA_TOKEN_SOURCE";
const LATER = "TEST_LINEAR_TOKEN_SOURCE";

const saveServer = (id: string, variable: string) => HttpClient.execute(
  HttpClientRequest.put(`/api/mcp-servers/${id}`).pipe(
    HttpClientRequest.bodyJsonUnsafe({
      baseHash: null,
      server: {
        title: id,
        transport: { type: "stdio", command: "jira-mcp", args: [], env: { JIRA_TOKEN: `\${env:${variable}}`, JIRA_FILE: `\${file:${referenced}}` }, cwd: null },
        scope: "app",
        default: false,
        access: null,
        oauth: null,
      },
    }),
  ),
).pipe(Effect.tap((response) => Effect.sync(() => expect(response.status).toBe(200))));

const app = makeTestApp({
  providers: provider.registry,
  secrets: makeTestSecrets({ declared: { files: new Map([["github", declared]]), problems: [] }, onRoot: (root) => (secretsRoot = root) }),
});

layer(app)("files and variables holding secrets", (it) => {
  it.effect("tells every turn what no tool may reach: the store, its key, declared files, MCP servers' files and .env files", () =>
    Effect.gen(function* () {
      yield* saveServer("jira", VARIABLE);
      const vault = yield* newVault;
      const thread = yield* newThread(vault.id, "scripted");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, "hello");
      yield* events.until(isTag("turn.finished"));
      const { paths, names } = provider.inputs.at(-1)!.protection;
      expect(paths).toEqual(
        expect.arrayContaining([join(secretsRoot, "data"), join(secretsRoot, "state", "secrets.key"), join(secretsRoot, "state", "secrets.key.cred"), declared, referenced]),
      );
      expect(paths).not.toContain(vault.rootPath);
      // WIKI_AGENTS_PROTECTED_PATHS is unset here: the default name patterns.
      expect(names).toEqual([".env", ".env.*", "!.env.example"]);
    }),
  );

  it.effect("withholds the variables MCP servers take secrets from, from the moment a server refers to them", () =>
    Effect.gen(function* () {
      process.env[LATER] = "token-value";
      const material = yield* SecretMaterial;
      const environment = yield* makeProviderEnvironment(() => material.latest().envNames);
      yield* material.current;
      expect(environment()[LATER]).toBe("token-value");
      yield* saveServer("linear", LATER);
      // Every turn reads the list again before the provider starts or the tools connect.
      expect((yield* material.current).envNames).toEqual(expect.arrayContaining([VARIABLE, LATER]));
      expect(environment()).not.toHaveProperty(LATER);
      expect(environment().PATH).toBe(process.env.PATH);
    }).pipe(Effect.ensuring(Effect.sync(() => delete process.env[LATER]))),
  );
});
