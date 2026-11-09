import { Schema } from "effect";

/** GET /api/vaults/:vaultId/tags: every frontmatter tag in the vault. */
export const ListTagsRequest = Schema.Struct({
  vaultId: Schema.String,
});
export type ListTagsRequest = typeof ListTagsRequest.Type;
