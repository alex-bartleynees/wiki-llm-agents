import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";
import { READ_CHUNK_BYTES, readRegularFile } from "./node-files.js";

const fileWith = (bytes: Uint8Array) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const folder = mkdtempSync(join(tmpdir(), "wiki-agents-node-files-"));
      writeFileSync(join(folder, "file"), bytes);
      return folder;
    }),
    (folder) => Effect.sync(() => rmSync(folder, { recursive: true, force: true })),
  ).pipe(Effect.map((folder) => join(folder, "file")));

const recordHashUpdates = Effect.acquireRelease(
  Effect.sync(() => vi.spyOn(Object.getPrototypeOf(createHash("sha256")) as ReturnType<typeof createHash>, "update")),
  (spy) => Effect.sync(() => spy.mockRestore()),
);

describe("readRegularFile", () => {
  it.effect.each([0, 1, READ_CHUNK_BYTES - 1, READ_CHUNK_BYTES, READ_CHUNK_BYTES + 1, 3 * READ_CHUNK_BYTES + 7])(
    "returns the content and its sha256 for %d bytes",
    (size) =>
      Effect.gen(function* () {
        const content = randomBytes(size);
        const read = yield* readRegularFile(yield* fileWith(content), size);
        expect(content.equals(read.bytes)).toBe(true);
        expect(read.digest).toBe(createHash("sha256").update(content).digest("hex"));
      }),
  );

  it.effect("never hashes more than one chunk at a time", () =>
    Effect.gen(function* () {
      const size = 4 * READ_CHUNK_BYTES + 1;
      const path = yield* fileWith(randomBytes(size));
      const updates = yield* recordHashUpdates;
      yield* readRegularFile(path, size);
      const sizes = updates.mock.calls.map(([data]) => Buffer.byteLength(data));
      expect(sizes.reduce((sum, length) => sum + length, 0)).toBe(size);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(READ_CHUNK_BYTES);
    }),
  );

  it.effect("refuses a file over the limit", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(readRegularFile(yield* fileWith(randomBytes(2)), 1));
      expect(error._tag).toBe("UnsupportedFile");
    }),
  );
});
