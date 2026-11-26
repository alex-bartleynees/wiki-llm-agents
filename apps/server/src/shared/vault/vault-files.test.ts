import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { describe, expect, layer } from "@effect/vitest";
import { Effect, FileSystem, Layer, PlatformError } from "effect";
import { listVaultFiles } from "./vault-files.js";

layer(NodeFileSystem.layer)("listVaultFiles", (it) => {
  it.effect("walks deep directory trees and returns sorted vault-relative paths", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();
      for (let i = 0; i < 24; i++) {
        const dir = join(root, `dir-${String(i).padStart(2, "0")}`, "nested");
        yield* fs.makeDirectory(dir, { recursive: true });
        yield* fs.writeFileString(join(dir, "note.md"), `# Note ${i}`);
      }
      const files = yield* listVaultFiles(root);
      expect(files).toHaveLength(24);
      expect(files[0]).toBe("dir-00/nested/note.md");
      expect(files[23]).toBe("dir-23/nested/note.md");
    }),
  );

  it.effect("indexes a symlinked folder deterministically under the earliest sorted path and avoids loops", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();
      const target = join(root, "m-real");
      yield* fs.makeDirectory(target, { recursive: true });
      yield* fs.writeFileString(join(target, "doc.md"), "# Doc");
      yield* fs.symlink(target, join(root, "a-link"));
      yield* fs.symlink(target, join(root, "z-link"));
      yield* fs.symlink(root, join(target, "loop"));

      const files = yield* listVaultFiles(root);
      expect(files).toEqual(["a-link/doc.md"]);
    }),
  );

  it.effect("skips directories that vanish with NotFound but fails on other read errors", () =>
    Effect.gen(function* () {
      const realFs = yield* FileSystem.FileSystem;
      const root = yield* realFs.makeTempDirectoryScoped();
      const vanished = join(root, "vanished");
      const broken = join(root, "broken");
      yield* realFs.makeDirectory(vanished);
      yield* realFs.makeDirectory(broken);
      yield* realFs.writeFileString(join(root, "ok.md"), "# Ok");

      const withNotFound = Layer.succeed(
        FileSystem.FileSystem,
        FileSystem.make({
          ...realFs,
          readDirectoryEntries: (path) =>
            path === vanished
              ? Effect.fail(
                  PlatformError.systemError({
                    _tag: "NotFound",
                    module: "FileSystem",
                    method: "readDirectoryEntries",
                    pathOrDescriptor: path,
                  }),
                )
              : realFs.readDirectoryEntries(path),
        }),
      );
      expect(yield* listVaultFiles(root).pipe(Effect.provide(withNotFound))).toEqual(["ok.md"]);

      const withPermissionDenied = Layer.succeed(
        FileSystem.FileSystem,
        FileSystem.make({
          ...realFs,
          readDirectoryEntries: (path) =>
            path === broken
              ? Effect.fail(
                  PlatformError.systemError({
                    _tag: "PermissionDenied",
                    module: "FileSystem",
                    method: "readDirectoryEntries",
                    pathOrDescriptor: path,
                  }),
                )
              : realFs.readDirectoryEntries(path),
        }),
      );
      const failure = yield* Effect.flip(listVaultFiles(root).pipe(Effect.provide(withPermissionDenied)));
      expect(failure.reason._tag).toBe("PermissionDenied");
    }),
  );
});
