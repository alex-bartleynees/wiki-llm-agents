import { Schema } from "effect";

export const ListFoldersResponse = Schema.Struct({
  /** The folder listed, canonical (symlinks resolved). */
  path: Schema.String,
  /** The folder above it; null at the root. */
  parent: Schema.NullOr(Schema.String),
  /** The home folder, as a starting point. */
  home: Schema.String,
  /** Its folders by name, hidden (dot) folders left out. A symlink to a folder counts. */
  folders: Schema.Array(Schema.Struct({ name: Schema.String, path: Schema.String })),
});
export type ListFoldersResponse = typeof ListFoldersResponse.Type;
