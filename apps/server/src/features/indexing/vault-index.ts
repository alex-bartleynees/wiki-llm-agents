import type { Backlink } from "@wiki-agents/contracts/notes/get-backlinks/response";
import type { FileKind } from "@wiki-agents/contracts/notes/model";
import type { TagCount } from "@wiki-agents/contracts/search/list-tags/response";
import type { SearchResult } from "@wiki-agents/contracts/search/search-notes/response";
import { Context, type Effect } from "effect";
import type { DbError } from "../../shared/persistence/errors.js";
import type { IndexedFile } from "./store.js";

/** A vault file with the title the app shows for it. */
export interface TitledFile {
  readonly path: string;
  readonly kind: FileKind;
  /** The note's title; the file name for other files. */
  readonly title: string;
}

export interface SearchQuery {
  /** What the user typed: words match by prefix, `"quoted phrases"` exactly. */
  readonly text: string;
  /** Lower-case tags the note must all have (`a` also matches `a/b`). */
  readonly tags: ReadonlyArray<string>;
  readonly limit: number;
}

export interface SearchResults {
  readonly results: ReadonlyArray<SearchResult>;
  /** More notes matched than `limit`. */
  readonly truncated: boolean;
}

/**
 * Read side of the vault index: the port other features (notes, search, pins, later
 * MCP) use instead of the SQLite adapter.
 */
export interface VaultIndexService {
  /** Every visible file in the vault, sorted by path. */
  readonly files: (vaultId: string) => Effect.Effect<ReadonlyArray<IndexedFile>, DbError>;
  /** Every visible file with its title, unsorted. */
  readonly titledFiles: (vaultId: string) => Effect.Effect<ReadonlyArray<TitledFile>, DbError>;
  /** Notes linking to or embedding `path`, sorted by title, without `path` itself. */
  readonly backlinks: (vaultId: string, path: string) => Effect.Effect<ReadonlyArray<Backlink>, DbError>;
  readonly counts: (vaultId: string) => Effect.Effect<{ readonly files: number; readonly notes: number }, DbError>;
  /**
   * Full-text search, best match first (title counts most, then tags, then body).
   * With no searchable text but some tags, every note with the tags, by title.
   * With neither, nothing.
   */
  readonly search: (vaultId: string, query: SearchQuery) => Effect.Effect<SearchResults, DbError>;
  /** Frontmatter tags with how many notes have each, most used first. */
  readonly tags: (vaultId: string) => Effect.Effect<ReadonlyArray<TagCount>, DbError>;
}

export class VaultIndex extends Context.Service<VaultIndex, VaultIndexService>()("VaultIndex") {}
