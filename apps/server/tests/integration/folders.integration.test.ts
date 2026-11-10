import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, layer } from "@effect/vitest";
import { ListFoldersResponse } from "@wiki-agents/contracts/folders/list-folders/response";
import { Effect } from "effect";
import { HttpClient } from "effect/http";
import { TestApp } from "./infrastructure/test-app.js";
import { decode } from "./infrastructure/threads.js";

const temp = Effect.acquireRelease(
  Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), "wiki-folders-")))),
  (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
);
const get = (path?: string) => HttpClient.get(path === undefined ? "/api/folders" : `/api/folders?path=${encodeURIComponent(path)}`);
const list = (path?: string) => get(path).pipe(Effect.flatMap(decode(ListFoldersResponse)));

layer(TestApp)("folders", (it) => {
  it.effect("lists a folder's folders by name, with symlinked folders and without hidden ones or files", () =>
    Effect.gen(function* () {
      const dir = yield* temp;
      for (const name of ["beta", "Alpha", "app10", "app9", ".git", "elsewhere"]) mkdirSync(join(dir, name));
      writeFileSync(join(dir, "notes.md"), "a file");
      symlinkSync(join(dir, "elsewhere"), join(dir, "linked"));
      symlinkSync(join(dir, "notes.md"), join(dir, "linked-file"));
      symlinkSync(join(dir, "missing"), join(dir, "broken"));
      const result = yield* list(dir);
      expect(result.path).toBe(dir);
      expect(result.parent).toBe(dirname(dir));
      expect(result.folders.map((folder) => folder.name)).toEqual(["Alpha", "app9", "app10", "beta", "elsewhere", "linked"]);
      expect(result.folders.find((folder) => folder.name === "linked")?.path).toBe(join(dir, "linked"));
    }),
  );

  it.effect("starts at the home folder, follows a path through symlinks, and has no parent at the root", () =>
    Effect.gen(function* () {
      expect((yield* list()).path).toBe(realpathSync(homedir()));
      expect((yield* list("~")).home).toBe(homedir());
      expect((yield* list("/")).parent).toBeNull();
      const dir = yield* temp;
      mkdirSync(join(dir, "real"));
      symlinkSync(join(dir, "real"), join(dir, "link"));
      expect((yield* list(join(dir, "link"))).path).toBe(join(dir, "real"));
    }),
  );

  it.effect("refuses relative paths and files, and reports missing folders", () =>
    Effect.gen(function* () {
      const dir = yield* temp;
      writeFileSync(join(dir, "file.txt"), "");
      expect((yield* get("relative/path")).status).toBe(400);
      expect((yield* get(join(dir, "file.txt"))).status).toBe(400);
      expect((yield* get(join(dir, "missing"))).status).toBe(404);
    }),
  );
});
