import { Schema } from "effect";

/** A note that links to or embeds the requested file. */
export const Backlink = Schema.Struct({
  path: Schema.String,
  title: Schema.String,
});
export type Backlink = typeof Backlink.Type;

/** Notes linking to the file, by title. A note never lists itself. */
export const GetBacklinksResponse = Schema.Struct({
  backlinks: Schema.Array(Backlink),
});
export type GetBacklinksResponse = typeof GetBacklinksResponse.Type;
