import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { VaultIndex } from "../../../indexing/vault-index.js";
import { findVault } from "../../../vaults/find-vault.js";
import { VaultCaller } from "../../auth.js";
import { Notices, vaultTool } from "../shared.js";

const Unavailable = Schema.Struct({ feature: Schema.String, reason: Schema.String });

export const VaultStatus = vaultTool(
  Tool.make("vault_status", {
    description:
      "This thread's vault, the state of its index, which vault tools work, and what is unavailable and why. Answers even when the other tools can't.",
    success: Schema.Struct({
      vault: Schema.NullOr(Schema.Struct({ name: Schema.String, path: Schema.String })),
      index: Schema.NullOr(Schema.Struct({ notes: Schema.Number, files: Schema.Number })),
      search: Schema.String,
      tools: Schema.Array(Schema.String),
      unavailable: Schema.Array(Unavailable),
      notices: Notices,
    }),
    dependencies: [VaultCaller],
  }),
);

/** Features the app doesn't offer agents yet, so agents don't look for them. */
const NOT_YET: ReadonlyArray<typeof Unavailable.Type> = [
  { feature: "semantic search", reason: "Not set up yet (rag-ai comes later); vault_search matches keywords only." },
  { feature: "who changed a file", reason: "Not recorded until change review exists; vault_recent_changes shows file times only." },
];

/** Each part is read on its own, so a failure in one is reported rather than failing the answer. */
export const vaultStatus = (tools: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const { vaultId } = yield* VaultCaller;
    const unavailable: Array<typeof Unavailable.Type> = [...NOT_YET];
    const notices: Array<string> = [];

    const vault = yield* findVault(vaultId).pipe(
      Effect.map((found) => ({ name: found.name, path: found.rootPath })),
      Effect.catch((error) => {
        unavailable.push({
          feature: "every vault tool",
          reason: error._tag === "VaultNotFound" ? "This thread's vault is no longer registered." : "The app's database couldn't be read.",
        });
        return Effect.succeed(null);
      }),
    );
    const index = yield* (yield* VaultIndex).counts(vaultId).pipe(
      Effect.catch(() => {
        unavailable.push({ feature: "search, links, backlinks, recent changes", reason: "The vault index couldn't be read just now." });
        return Effect.succeed(null);
      }),
    );
    if (index !== null && index.notes === 0) notices.push("The index has no notes: the vault is empty or still being indexed for the first time.");
    notices.push("The index follows the files on disk as they change, usually within a second.");
    return {
      vault,
      index,
      search: "keyword (SQLite FTS5, bm25 ranking: title, then tags, then body)",
      tools: vault === null ? [] : tools,
      unavailable,
      notices,
    };
  });
