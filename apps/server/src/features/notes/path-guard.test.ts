import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { isInside, normaliseVaultPath, resolveInVault } from "./path-guard.js";

describe("normaliseVaultPath", () => {
  it.each([
    ["note.md", "note.md"],
    ["a//b/./c.md", "a/b/c.md"],
    ["a/b/", "a/b"],
    ["../outside.md", undefined],
    ["a/../../outside.md", undefined],
    ["a/../b.md", undefined],
    ["/etc/passwd", undefined],
    ["", undefined],
    [".", undefined],
    ["a\0b.md", undefined],
    [".obsidian/app.json", undefined],
    [".git/config", undefined],
    ["a/.trash/old.md", undefined],
    ["note.sync-conflict-20260803-092856-ZMVBMAF.md", undefined],
  ])("%j → %j", (input, expected) => {
    expect(normaliseVaultPath(input)).toBe(expected);
  });
});

describe("isInside", () => {
  it.each([
    ["/v", "/v", true],
    ["/v", "/v/a.md", true],
    ["/v", "/v2/a.md", false],
    ["/v", "/a.md", false],
    ["/v", "/v/..a.md", true],
  ])("%s contains %s → %s", (root, target, expected) => {
    expect(isInside(root, target)).toBe(expected);
  });
});

describe("resolveInVault", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "wiki-agents-guard-")));
  const vault = join(base, "vault");
  const outside = join(base, "outside");
  mkdirSync(join(vault, "notes"), { recursive: true });
  mkdirSync(join(vault, ".git"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(vault, "notes", "a.md"), "# A");
  writeFileSync(join(vault, ".git", "config"), "secret");
  writeFileSync(join(outside, "secret.md"), "secret");
  symlinkSync(join(outside, "secret.md"), join(vault, "escape.md"));
  symlinkSync(outside, join(vault, "escape-dir"));
  symlinkSync(join(vault, "notes", "a.md"), join(vault, "alias.md"));
  symlinkSync(join(vault, ".git", "config"), join(vault, "git-config.md"));

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  const resolve = (path: string) =>
    resolveInVault(vault, path).pipe(Effect.provide(NodeFileSystem.layer), Effect.exit);

  it.effect("resolves a note inside the vault", () =>
    Effect.gen(function* () {
      const exit = yield* resolve("notes//a.md");
      expect(exit).toEqual(Exit.succeed({ path: "notes/a.md", absolute: join(vault, "notes", "a.md") }));
    }),
  );

  it.effect("follows a symlink that stays inside the vault", () =>
    Effect.gen(function* () {
      const exit = yield* resolve("alias.md");
      expect(exit).toEqual(Exit.succeed({ path: "alias.md", absolute: join(vault, "notes", "a.md") }));
    }),
  );

  it.effect.each([
    ["../outside/secret.md", "traversal"],
    ["escape.md", "a file symlink out of the vault"],
    ["escape-dir/secret.md", "a folder symlink out of the vault"],
    ["git-config.md", "a symlink into an ignored folder"],
    [".git/config", "an ignored folder"],
  ] as const)("refuses %s (%s)", ([path]) =>
    Effect.gen(function* () {
      const exit = yield* resolve(path);
      expect(Exit.isFailure(exit) && exit.cause.toString()).toContain("InvalidVaultPath");
    }),
  );

  it.effect("reports a missing file as not found", () =>
    Effect.gen(function* () {
      const exit = yield* resolve("notes/missing.md");
      expect(Exit.isFailure(exit) && exit.cause.toString()).toContain("VaultFileNotFound");
    }),
  );

});
