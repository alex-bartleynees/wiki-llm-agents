import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { relatedNotes } from "../../../search/related.js";
import { VaultCaller } from "../../auth.js";
import { IntBetween, Notices, ToolFailure, VaultPath, vaultTool } from "../shared.js";
export const VaultRelated = vaultTool(Tool.make("vault_related", {
  description: "Related notes ranked by direct links, rare shared neighbours, shared tags and folder.",
  parameters: Schema.Struct({ path: VaultPath, limit: Schema.optionalKey(IntBetween(1, 50, "Maximum notes (default 10).")) }),
  success: Schema.Struct({ notes: Schema.Array(Schema.Struct({ path: Schema.String, title: Schema.String, score: Schema.Number, reasons: Schema.Array(Schema.String) })), notices: Notices }),
  failure: ToolFailure, dependencies: [VaultCaller],
}));
export const vaultRelated = Effect.fnUntraced(function* (params: typeof VaultRelated.parametersSchema.Type) {
  const { vaultId } = yield* VaultCaller;
  const ranked = yield* relatedNotes(vaultId, params.path);
  const limit = params.limit ?? 10;
  return { notes: ranked.slice(0, limit), notices: ranked.length > limit ? [`Showing ${limit} of ${ranked.length} related notes.`] : [] };
}, Effect.catch(() => Effect.fail(new ToolFailure({ message: "Related notes are unavailable; try vault_search." }))));
