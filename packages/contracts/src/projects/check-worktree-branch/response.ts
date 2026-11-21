import { Schema } from "effect";

export const CheckWorktreeBranchResponse = Schema.Union([
  Schema.Struct({ status: Schema.Literal("ready"), branch: Schema.String, target: Schema.String, confirmation: Schema.String }),
  Schema.Struct({ status: Schema.Literal("blocked"), reason: Schema.String }),
  Schema.Struct({ status: Schema.Literal("deleted") }),
]);
export type CheckWorktreeBranchResponse = typeof CheckWorktreeBranchResponse.Type;
