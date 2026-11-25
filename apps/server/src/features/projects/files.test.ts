import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { snapshot } from "./files.js";

const Platform = NodeChildProcessSpawner.layer.pipe(Layer.provideMerge(Layer.merge(NodeFileSystem.layer, NodePath.layer)));

const repository = Effect.acquireRelease(
  Effect.sync(() => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "wiki-files-")));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    writeFileSync(join(dir, "app.ts"), "one\n");
    return dir;
  }),
  (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
);

describe("project file snapshots", () => {
  it.effect("keeps hashes recorded with fractional modification times", () =>
    Effect.gen(function* () {
      const dir = yield* repository;
      const old = new Date("2020-01-01T00:00:00Z");
      const path = join(dir, "app.ts");
      utimesSync(path, old, old);
      const [file] = yield* snapshot([dir]);
      expect(file?.modifiedAt).toBe(old.getTime());
      const recorded = { ...file!, hash: "recorded", modifiedAt: old.getTime() + 0.456 };
      expect((yield* snapshot([dir], [recorded]))[0]?.hash).toBe("recorded");
    }).pipe(Effect.provide(Platform)));
});
