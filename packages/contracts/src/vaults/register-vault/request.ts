import { Schema } from "effect";

export const RegisterVaultRequest = Schema.Struct({
  rootPath: Schema.String.check(Schema.isNonEmpty()),
  name: Schema.optionalKey(Schema.String),
});
export type RegisterVaultRequest = typeof RegisterVaultRequest.Type;
