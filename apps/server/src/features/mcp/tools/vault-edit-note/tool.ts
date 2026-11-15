import { Schema } from "effect";
import { Tool } from "effect/ai";
import { VaultCaller } from "../../auth.js";
import { Notices, ToolFailure, VaultPath, vaultTool } from "../shared.js";
import { writeVaultNote } from "../write-note.js";

export const VaultEditNote = vaultTool(Tool.make("vault_edit_note", {
  description: "Replace a markdown note after a complete vault_read_note in this turn. Requires its baseHash; stale, partial and truncated reads are refused. Follows edit autonomy with an exact approval diff.",
  parameters: Schema.Struct({ path: VaultPath, content: Schema.String, baseHash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)).annotate({ description: "SHA-256 from a complete vault_read_note in this turn." }) }),
  success: Schema.Struct({ path: Schema.String, hash: Schema.String, notices: Notices }),
  failure: ToolFailure, dependencies: [VaultCaller],
})).annotate(Tool.Readonly, false).annotate(Tool.Destructive, true);

export const vaultEditNote = (params: typeof VaultEditNote.parametersSchema.Type) =>
  writeVaultNote({ ...params });
