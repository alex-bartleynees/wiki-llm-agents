import { Schema } from "effect";
import { Tool } from "effect/ai";
import { VaultCaller } from "../../auth.js";
import { Notices, ToolFailure, VaultPath, vaultTool } from "../shared.js";
import { writeVaultNote } from "../write-note.js";

export const VaultCreateNote = vaultTool(Tool.make("vault_create_note", {
  description: "Create a markdown note only if it does not exist. Follows create autonomy; asks with the exact proposed content when needed.",
  parameters: Schema.Struct({ path: VaultPath, content: Schema.String }),
  success: Schema.Struct({ path: Schema.String, hash: Schema.String, notices: Notices }),
  failure: ToolFailure, dependencies: [VaultCaller],
})).annotate(Tool.Readonly, false).annotate(Tool.Destructive, false);

export const vaultCreateNote = (params: typeof VaultCreateNote.parametersSchema.Type) =>
  writeVaultNote({ ...params, baseHash: null });
