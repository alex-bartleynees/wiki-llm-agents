import { Schema } from "effect";

export const CheckWorktreeBranchRequest = Schema.Struct({ projectId: Schema.String, threadId: Schema.String });
