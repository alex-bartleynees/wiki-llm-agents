import type { SearchResult } from "@wiki-agents/contracts/search/search-notes/response";
import { type SQL, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { ftsMatch, leadParts, MATCH_END, MATCH_START, snippetParts } from "./fts-query.js";
import type { SearchQuery, SearchResults } from "./vault-index.js";

/*
 * Search over `notes_fts` (body, title, tags) joined to `notes`. Raw SQL because
 * Drizzle can't express FTS5's MATCH, bm25(), or snippet().
 */

/** bm25 weights per `notes_fts` column: vault_id, path (unindexed), title, body, tags. */
const RANK = sql`bm25(notes_fts, 0.0, 0.0, 10.0, 1.0, 5.0)`;

/** Words of context around the best match in the body. */
const SNIPPET_TOKENS = 24;

interface Row {
  readonly path: string;
  readonly title: string;
  /** JSON array, as stored in `notes.tags`. */
  readonly tags: string;
  readonly text: string;
}

/**
 * The note has the tag or a child of it (`project` matches `project/app`), ignoring
 * ASCII case (SQLite's `lower()` leaves other letters alone).
 */
const hasTag = (tag: string): SQL =>
  sql`EXISTS (SELECT 1 FROM json_each(notes.tags) AS t WHERE lower(t.value) = ${tag} OR substr(lower(t.value), 1, ${tag.length + 1}) = ${`${tag}/`})`;

const tagFilter = (tags: ReadonlyArray<string>): SQL =>
  tags.length === 0 ? sql`` : sql` AND ${sql.join(tags.map(hasTag), sql` AND `)}`;

/** `path` is one of `folders` or inside one; no condition when `folders` is absent. */
export const folderFilter = (path: SQL, folders: ReadonlyArray<string> | undefined): SQL =>
  folders === undefined
    ? sql``
    : folders.length === 0
      ? sql` AND 0`
      : sql` AND (${sql.join(
          folders.map((folder) => sql`(${path} = ${folder} OR substr(${path}, 1, ${folder.length + 1}) = ${`${folder}/`})`),
          sql` OR `,
        )})`;

const toResult =(row: Row, snippet: SearchResult["snippet"]): SearchResult => {
  const tags: unknown = JSON.parse(row.tags);
  return {
    path: row.path,
    title: row.title,
    tags: Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [],
    snippet,
  };
};

export const searchNotes = (db: BetterSQLite3Database, vaultId: string, query: SearchQuery): SearchResults => {
  const match = ftsMatch(query.text);
  const filters = sql`${tagFilter(query.tags)}${folderFilter(sql`notes.path`, query.folders)}`;
  // One extra row tells whether there were more.
  const take = query.limit + 1;

  let rows: Array<SearchResult>;
  if (match !== undefined) {
    rows = db
      .all<Row>(
        sql`SELECT notes.path AS path, notes.title AS title, notes.tags AS tags,
              snippet(notes_fts, 3, ${MATCH_START}, ${MATCH_END}, '…', ${SNIPPET_TOKENS}) AS text
            FROM notes_fts
            JOIN notes ON notes.vault_id = notes_fts.vault_id AND notes.path = notes_fts.path
            WHERE notes_fts MATCH ${match} AND notes_fts.vault_id = ${vaultId}${filters}
            ORDER BY ${RANK}, notes.path
            LIMIT ${take}`,
      )
      .map((row) => toResult(row, snippetParts(row.text)));
  } else if (query.tags.length > 0) {
    rows = db
      .all<Row>(
        sql`SELECT notes.path AS path, notes.title AS title, notes.tags AS tags, blobs.content AS text
            FROM notes
            JOIN blobs ON blobs.hash = notes.content_hash
            WHERE notes.vault_id = ${vaultId}${filters}
            ORDER BY notes.title COLLATE NOCASE, notes.path
            LIMIT ${take}`,
      )
      .map((row) => toResult(row, leadParts(row.text)));
  } else {
    rows = [];
  }

  return { results: rows.slice(0, query.limit), truncated: rows.length > query.limit };
};
