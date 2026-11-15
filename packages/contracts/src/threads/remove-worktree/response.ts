import { Schema } from "effect";
import { Worktree } from "../../projects/model.js";

export const RemoveWorktreeResponse = Schema.Struct({ worktree: Worktree });
export type RemoveWorktreeResponse = typeof RemoveWorktreeResponse.Type;
