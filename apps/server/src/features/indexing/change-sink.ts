import { Context, Effect, Layer } from "effect";
import type { DbError } from "../../shared/persistence/errors.js";

/** A note's content changed in the index: hashes before and after (null when it didn't exist). */
export interface NoteChange {
  readonly path: string;
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
}

/**
 * Told about every note change the indexer applies, before the index forgets the old
 * version, so change review can keep it (see `changes/change-tracker.ts`). The
 * indexer defines the port so it doesn't depend on change review.
 */
export interface FileChangeSinkService {
  readonly noteChanged: (vaultId: string, change: NoteChange) => Effect.Effect<void, DbError>;
}

export class FileChangeSink extends Context.Service<FileChangeSink, FileChangeSinkService>()("FileChangeSink") {}

/** For tests and tools without change review. */
export const FileChangeSinkNoop = Layer.succeed(FileChangeSink, FileChangeSink.of({ noteChanged: () => Effect.void }));
