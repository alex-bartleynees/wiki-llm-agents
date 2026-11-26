import { Schema } from "effect";

export const RemoveWorkingDirectoryRequest = Schema.Struct({
  path: Schema.String,
});
export type RemoveWorkingDirectoryRequest = typeof RemoveWorkingDirectoryRequest.Type;
