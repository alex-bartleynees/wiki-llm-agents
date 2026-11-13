import { Clock, Duration, Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { VaultIndex } from "../../../indexing/vault-index.js";
import { VaultCaller } from "../../auth.js";
import { scopeFolders, scopeNotices, usableScope } from "../../scope.js";
import { IntBetween, indexUnavailable, iso, Notices, ToolFailure, vaultTool } from "../shared.js";

const DEFAULT_DAYS = 7;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 200;

/** Until change review (slice 9) records who changed what, only the file times are known. */
export const NO_ATTRIBUTION =
  "Who changed a file isn't recorded yet: these are the files' modification times, whether you, the user, another agent or a sync changed them.";

export const VaultRecentChanges = vaultTool(
  Tool.make("vault_recent_changes", {
    description: "Files in the vault changed recently, newest first.",
    parameters: Schema.Struct({
      days: Schema.optionalKey(IntBetween(1, 365, `How many days back to look (default ${DEFAULT_DAYS}).`)),
      limit: Schema.optionalKey(IntBetween(1, MAX_LIMIT, `Most files to return (default ${DEFAULT_LIMIT}).`)),
    }),
    success: Schema.Struct({
      since: Schema.String,
      changes: Schema.Array(
        Schema.Struct({
          path: Schema.String,
          title: Schema.String,
          kind: Schema.Literals(["note", "page", "json", "file"]),
          modifiedAt: Schema.String,
        }),
      ),
      notices: Notices,
    }),
    failure: ToolFailure,
    dependencies: [VaultCaller],
  }),
);

export const vaultRecentChanges = Effect.fnUntraced(function* (params: typeof VaultRecentChanges.parametersSchema.Type) {
  const { vaultId } = yield* VaultCaller;
  const scope = yield* usableScope;
  const days = params.days ?? DEFAULT_DAYS;
  const limit = params.limit ?? DEFAULT_LIMIT;
  const since = (yield* Clock.currentTimeMillis) - Duration.toMillis(Duration.days(days));
  const { files, truncated } = yield* (yield* VaultIndex).recentFiles(vaultId, { since, limit, folders: scopeFolders(scope) });
  const notices: Array<string> = [...scopeNotices(scope)];
  if (truncated) notices.push(`Showing the ${limit} most recent; more changed in the last ${days} days. Raise \`limit\` (up to ${MAX_LIMIT}) or lower \`days\`.`);
  if (files.length === 0) notices.push(`Nothing changed in the last ${days} days.`);
  notices.push(NO_ATTRIBUTION);
  return {
    since: iso(since),
    changes: files.map((file) => ({ path: file.path, title: file.title, kind: file.kind, modifiedAt: iso(file.modifiedAt) })),
    notices,
  };
}, Effect.catchTags({ DbError: () => Effect.fail(indexUnavailable()) }));
