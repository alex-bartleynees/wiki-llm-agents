import { Schema } from "effect";

export const UpdateVaultRequest = Schema.Struct({
  templateFolder: Schema.NullOr(Schema.String),
});
export type UpdateVaultRequest = typeof UpdateVaultRequest.Type;
