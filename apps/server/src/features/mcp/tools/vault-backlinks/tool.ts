import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { getBacklinks } from "../../../notes/get-backlinks/use-case.js";
import { VaultCaller } from "../../auth.js";
import { IntBetween, indexUnavailable, Notices, ToolFailure, VaultPath, vaultTool } from "../shared.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export const VaultBacklinks = vaultTool(
  Tool.make("vault_backlinks", {
    description: "Notes that link to or embed a file, by title. A note never lists itself.",
    parameters: Schema.Struct({
      path: VaultPath,
      limit: Schema.optionalKey(IntBetween(1, MAX_LIMIT, `Most backlinks to return (default ${DEFAULT_LIMIT}).`)),
    }),
    success: Schema.Struct({
      path: Schema.String,
      total: Schema.Number,
      backlinks: Schema.Array(Schema.Struct({ path: Schema.String, title: Schema.String })),
      notices: Notices,
    }),
    failure: ToolFailure,
    dependencies: [VaultCaller],
  }),
);

export const vaultBacklinks = Effect.fnUntraced(function* (params: typeof VaultBacklinks.parametersSchema.Type) {
  const { vaultId } = yield* VaultCaller;
  const limit = params.limit ?? DEFAULT_LIMIT;
  const { backlinks } = yield* getBacklinks({ vaultId, path: params.path });
  const notices: Array<string> = [];
  if (backlinks.length > limit) notices.push(`Showing ${limit} of ${backlinks.length} backlinks, by title. Raise \`limit\` (up to ${MAX_LIMIT}) for more.`);
  if (backlinks.length === 0) notices.push("No note links here. If the path may be wrong, check it with vault_resolve_link.");
  return { path: params.path, total: backlinks.length, backlinks: backlinks.slice(0, limit), notices };
}, Effect.catchTags({
  DbError: () => Effect.fail(indexUnavailable()),
  InvalidVaultPath: (error) => Effect.fail(new ToolFailure({ message: `"${error.path}" isn't a path inside the vault.` })),
  VaultNotFound: () => Effect.fail(new ToolFailure({ message: "This thread's vault is no longer registered." })),
}));
