import type { FileKind } from "@wiki-agents/contracts/notes/model";
import { Context, type Effect } from "effect";
import type { ExtractedLink, ExtractedNote, LinkKind } from "../../shared/markdown/extract.js";
import type { LinkIndex } from "../../shared/markdown/link-resolution.js";
import type { DbError } from "../../shared/persistence/errors.js";

export interface IndexedFile {
  readonly path: string;
  readonly kind: FileKind;
  readonly mtimeMs: number;
  readonly size: number;
}

export interface IndexedFileWithHash extends IndexedFile {
  /** For notes, the hash of the indexed content; null for other files. */
  readonly contentHash: string | null;
}

export interface IndexedLink {
  readonly srcPath: string;
  readonly kind: LinkKind;
  readonly target: string;
  readonly targetPath: string | null;
}

export interface NoteLinkToIndex extends ExtractedLink {
  readonly targetPath?: string | null;
}

/** The note as extracted, plus its raw content and hash. */
export interface NoteToIndex extends Omit<ExtractedNote, "links"> {
  readonly links: ReadonlyArray<NoteLinkToIndex>;
  readonly content: string;
  readonly contentHash: string;
}

export interface IndexBatch {
  readonly files: ReadonlyArray<IndexedFile>;
  readonly notes: ReadonlyArray<{ readonly file: IndexedFile; readonly note: NoteToIndex }>;
  readonly pathsChanged: boolean;
}

/** Write side of the vault index, used only by the indexer. */
export interface IndexStoreService {
  readonly files: (vaultId: string) => Effect.Effect<ReadonlyArray<IndexedFileWithHash>, DbError>;
  readonly filesByPath: (vaultId: string, paths: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<IndexedFileWithHash>, DbError>;
  readonly linkIndex: (vaultId: string) => Effect.Effect<LinkIndex, DbError>;
  readonly putBatch: (vaultId: string, batch: IndexBatch) => Effect.Effect<void, DbError>;
  /** Forgets files and everything derived from them; prunes blobs nothing refers to. */
  readonly remove: (vaultId: string, paths: ReadonlyArray<string>) => Effect.Effect<void, DbError>;
  readonly links: (vaultId: string) => Effect.Effect<ReadonlyArray<IndexedLink>, DbError>;
  readonly setLinkTargets: (vaultId: string, links: ReadonlyArray<IndexedLink>) => Effect.Effect<void, DbError>;
  /** Drops the vault's whole index (rebuild). */
  readonly clear: (vaultId: string) => Effect.Effect<void, DbError>;
}

export class IndexStore extends Context.Service<IndexStore, IndexStoreService>()("IndexStore") {}
