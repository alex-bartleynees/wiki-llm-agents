import { Schema } from "effect";

export const TagCount = Schema.Struct({
  tag: Schema.String,
  /** Notes with exactly this tag (not counting `tag/child`). */
  count: Schema.Number,
});
export type TagCount = typeof TagCount.Type;

/** Most used first, then by name. */
export const ListTagsResponse = Schema.Struct({
  tags: Schema.Array(TagCount),
});
export type ListTagsResponse = typeof ListTagsResponse.Type;
