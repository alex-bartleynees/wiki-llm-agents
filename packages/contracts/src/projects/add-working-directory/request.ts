import { Schema } from "effect";

export const AddWorkingDirectoryRequest = Schema.Struct({
  path: Schema.String.check(Schema.isNonEmpty()),
});
export type AddWorkingDirectoryRequest = typeof AddWorkingDirectoryRequest.Type;
