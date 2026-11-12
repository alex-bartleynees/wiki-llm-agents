import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, layer } from "@effect/vitest";
import { ListVaultsResponse } from "@wiki-agents/contracts/vaults/list-vaults/response";
import { RegisterVaultResponse } from "@wiki-agents/contracts/vaults/register-vault/response";
import { UpdateVaultResponse } from "@wiki-agents/contracts/vaults/update-vault/response";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { vaults } from "../../src/features/vaults/table.js";
import { Sqlite } from "../../src/shared/persistence/sqlite.js";
import { makeTestApp, TestApp } from "./infrastructure/test-app.js";

const listVaults = HttpClient.get("/api/vaults").pipe(
  Effect.flatMap(HttpClientResponse.filterStatusOk),
  Effect.flatMap(HttpClientResponse.schemaBodyJson(ListVaultsResponse)),
);

const postVault = (body: unknown) =>
  HttpClient.execute(HttpClientRequest.post("/api/vaults").pipe(HttpClientRequest.bodyJsonUnsafe(body)));

const base = realpathSync(mkdtempSync(join(tmpdir(), "wiki-agents-register-")));
const personal = join(base, "Personal Vault");
const work = join(base, "work");
mkdirSync(personal);
mkdirSync(work);
mkdirSync(join(personal, "Templates", "Daily"), { recursive: true });
writeFileSync(join(personal, "Note.md"), "# Note");
symlinkSync(personal, join(base, "link-to-personal"));
writeFileSync(join(base, "file.md"), "# not a folder");
afterAll(() => rmSync(base, { recursive: true, force: true }));

layer(TestApp)("GET /api/vaults", (it) => {
  it.effect("returns an empty list on a fresh database", () =>
    Effect.gen(function* () {
      expect(yield* listVaults).toEqual({ vaults: [] });
    }),
  );

  it.effect("returns registered vaults ordered by name", () =>
    Effect.gen(function* () {
      const { db } = yield* Sqlite;
      db.insert(vaults)
        .values([
          { id: "v2", name: "Work", rootPath: "/vaults/work", createdAt: new Date(0) },
          { id: "v1", name: "Personal", rootPath: "/vaults/personal", createdAt: new Date(0) },
        ])
        .run();

      expect(yield* listVaults).toEqual({
        vaults: [
          { id: "v1", name: "Personal", rootPath: "/vaults/personal", templateFolder: null },
          { id: "v2", name: "Work", rootPath: "/vaults/work", templateFolder: null },
        ],
      });
    }),
  );
});

layer(TestApp)("POST /api/vaults", (it) => {
  it.effect("registers a folder, named after it by default", () =>
    Effect.gen(function* () {
      const response = yield* postVault({ rootPath: personal });
      expect(response.status).toBe(201);
      const { vault } = yield* HttpClientResponse.schemaBodyJson(RegisterVaultResponse)(response);
      expect(vault).toMatchObject({ name: "Personal Vault", rootPath: personal });
      expect((yield* listVaults).vaults).toEqual([vault]);
    }),
  );

  it.effect("uses a given name", () =>
    Effect.gen(function* () {
      const response = yield* postVault({ rootPath: work, name: "  Day job " });
      expect(response.status).toBe(201);
      expect((yield* HttpClientResponse.schemaBodyJson(RegisterVaultResponse)(response)).vault.name).toBe("Day job");
    }),
  );

  it.effect("returns the existing vault for the same folder, also through a symlink", () =>
    Effect.gen(function* () {
      const before = yield* listVaults;
      const response = yield* postVault({ rootPath: join(base, "link-to-personal") });
      expect(response.status).toBe(200);
      const { vault } = yield* HttpClientResponse.schemaBodyJson(RegisterVaultResponse)(response);
      expect(vault.rootPath).toBe(personal);
      expect(yield* listVaults).toEqual(before);
    }),
  );

  it.effect.each([
    [{ rootPath: "relative/path" }, "Use an absolute path: relative/path"],
    [{ rootPath: join(base, "missing") }, `Folder not found: ${join(base, "missing")}`],
    [{ rootPath: join(base, "file.md") }, `Not a folder: ${join(base, "file.md")}`],
    [{ rootPath: "" }, "Invalid request"],
    [{ name: "no path" }, "Invalid request"],
  ] as const)("refuses %j", ([body, message]) =>
    Effect.gen(function* () {
      const response = yield* postVault(body);
      expect(response.status).toBe(400);
      expect(yield* response.text).toBe(message);
    }),
  );
});

describe("--vault start flag", () => {
  layer(makeTestApp({ vaults: [work, work] }))(
    "registers the folders once before serving",
    (it) => {
      it.effect("lists the vault", () =>
        Effect.gen(function* () {
          expect((yield* listVaults).vaults).toMatchObject([{ name: "work", rootPath: work }]);
        }),
      );
    },
  );
});

const patchVault = (vaultId: string, body: unknown) =>
  HttpClient.execute(HttpClientRequest.patch(`/api/vaults/${vaultId}`).pipe(HttpClientRequest.bodyJsonUnsafe(body)));

layer(TestApp)("PATCH /api/vaults/:vaultId", (it) => {
  it.effect("sets the template folder, normalised, and clears it", () =>
    Effect.gen(function* () {
      const { vault } = yield* postVault({ rootPath: personal }).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(RegisterVaultResponse)));
      expect(vault.templateFolder).toBeNull();

      const set = yield* patchVault(vault.id, { templateFolder: " ./Templates/Daily/ " });
      expect(set.status).toBe(200);
      expect((yield* HttpClientResponse.schemaBodyJson(UpdateVaultResponse)(set)).vault).toEqual({ ...vault, templateFolder: "Templates/Daily" });
      expect((yield* listVaults).vaults).toMatchObject([{ id: vault.id, templateFolder: "Templates/Daily" }]);

      const cleared = yield* patchVault(vault.id, { templateFolder: "" }).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(UpdateVaultResponse)));
      expect(cleared.vault.templateFolder).toBeNull();
      expect((yield* listVaults).vaults).toMatchObject([{ id: vault.id, templateFolder: null }]);
    }),
  );

  it.effect.each([
    [{ templateFolder: "Missing" }, 400, "Folder not found: Missing"],
    [{ templateFolder: "Note.md" }, 400, "Not a folder: Note.md"],
    [{ templateFolder: "../work" }, 400, "Not a folder in this vault: ../work"],
    [{ templateFolder: ".obsidian" }, 400, "Not a folder in this vault: .obsidian"],
    [{}, 400, "Invalid request"],
  ] as const)("refuses %j", ([body, status, message]) =>
    Effect.gen(function* () {
      const { vault } = yield* postVault({ rootPath: personal }).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(RegisterVaultResponse)));
      const response = yield* patchVault(vault.id, body);
      expect(response.status).toBe(status);
      expect(yield* response.text).toBe(message);
    }),
  );

  it.effect("answers 404 for an unknown vault", () =>
    Effect.gen(function* () {
      expect((yield* patchVault("nope", { templateFolder: null })).status).toBe(404);
    }),
  );
});
