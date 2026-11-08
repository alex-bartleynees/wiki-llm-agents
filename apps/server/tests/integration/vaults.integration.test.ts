import { expect, layer } from "@effect/vitest";
import { ListVaultsResponse } from "@wiki-agents/contracts/vaults/list-vaults/response";
import { Effect } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { vaults } from "../../src/features/vaults/table.js";
import { Sqlite } from "../../src/shared/persistence/sqlite.js";
import { TestApp } from "./infrastructure/test-app.js";

const listVaults = HttpClient.get("/api/vaults").pipe(
  Effect.flatMap(HttpClientResponse.filterStatusOk),
  Effect.flatMap(HttpClientResponse.schemaBodyJson(ListVaultsResponse)),
);

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
          { id: "v1", name: "Personal", rootPath: "/vaults/personal" },
          { id: "v2", name: "Work", rootPath: "/vaults/work" },
        ],
      });
    }),
  );
});
