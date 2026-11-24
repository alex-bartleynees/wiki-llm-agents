import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, rmdir, stat } from "node:fs/promises";
import { Data, Effect } from "effect";

export class NodeFileError extends Data.TaggedError("NodeFileError")<{ readonly path: string; readonly code: string | undefined; readonly cause: unknown }> {}

export class UnsupportedFile extends Data.TaggedError("UnsupportedFile")<{ readonly path: string }> {}

export class FileChangedWhileReading extends Data.TaggedError("FileChangedWhileReading")<{ readonly path: string }> {}

const failure = (path: string) => (cause: unknown) => new NodeFileError({ path, code: (cause as NodeJS.ErrnoException | undefined)?.code, cause });

export const READ_CHUNK_BYTES = 1024 * 1024;

export const readRegularFile = (path: string, limit: number) =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK),
      catch: failure(path),
    }),
    (handle) =>
      Effect.gen(function* () {
        const info = yield* Effect.tryPromise({ try: () => handle.stat(), catch: failure(path) });
        if (!info.isFile() || info.nlink !== 1 || info.size > limit) return yield* new UnsupportedFile({ path });
        const bytes = Buffer.alloc(info.size + 1);
        const hash = createHash("sha256");
        let length = 0;
        while (length < bytes.length) {
          const chunk = Math.min(READ_CHUNK_BYTES, bytes.length - length);
          const { bytesRead } = yield* Effect.tryPromise({ try: () => handle.read(bytes, length, chunk, null), catch: failure(path) });
          if (bytesRead === 0) break;
          hash.update(bytes.subarray(length, length + bytesRead));
          length += bytesRead;
        }
        if (length !== info.size) return yield* new FileChangedWhileReading({ path });
        return { bytes: bytes.subarray(0, length), digest: hash.digest("hex"), mode: info.mode & 0o777 };
      }),
    (handle) => Effect.tryPromise({ try: () => handle.close(), catch: failure(path) }),
  );

export const removeEmptyDirectory = (path: string) => Effect.tryPromise({ try: () => rmdir(path), catch: failure(path) });

export const preciseStat = (path: string) => Effect.tryPromise({ try: () => stat(path, { bigint: true }), catch: failure(path) });
