import { Schema } from "effect";

export const DeleteWorktreeBranchResponse = Schema.Struct({ status: Schema.Literal("deleted") });
