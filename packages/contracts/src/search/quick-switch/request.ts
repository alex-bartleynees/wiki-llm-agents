import { Schema } from "effect";

/**
 * GET /api/vaults/:vaultId/quick-switch?q=<text>: notes, pages, and JSON files whose
 * title or path contains the letters of `q` in order (fuzzy). Spaces are ignored.
 */
export const QuickSwitchRequest = Schema.Struct({
  vaultId: Schema.String,
  q: Schema.String,
});
export type QuickSwitchRequest = typeof QuickSwitchRequest.Type;
