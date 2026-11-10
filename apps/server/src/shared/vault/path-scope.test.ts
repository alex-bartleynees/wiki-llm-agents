import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { pathsWithinRoots } from "./path-scope.js";

describe("pathsWithinRoots", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "path-scope-")));
  afterAll(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "repo"), vault = join(base, "vault"), outside = join(base, "repo-other");
  for (const dir of [repo, vault, outside]) mkdirSync(dir);
  symlinkSync(outside, join(repo, "escape"));
  const within = (paths: ReadonlyArray<string>, roots: ReadonlyArray<string> = [repo, vault]) =>
    Effect.runPromise(pathsWithinRoots(roots, repo, paths).pipe(Effect.provide(NodeFileSystem.layer)));

  it("allows new and existing paths in any root, relative to the working directory", async () => {
    expect(await within(["new.ts", join(vault, "new.md"), join(repo, "*"), "deep/new/file.ts"])).toBe(true);
  });

  it("refuses paths outside, including through `..` and a symlink to a new file", async () => {
    expect(await within([join(outside, "new.ts")])).toBe(false);
    expect(await within(["../repo-other/new.ts"])).toBe(false);
    expect(await within(["escape/new.ts"])).toBe(false);
    expect(await within(["new.ts", join(outside, "new.ts")])).toBe(false);
  });

  it("refuses nothing to check, patterns, and roots that aren't canonical", async () => {
    expect(await within([])).toBe(false);
    expect(await within(["/tmp/*/file"])).toBe(false);
    expect(await within(["new.ts"], [join(repo, "escape")])).toBe(false);
  });
});
