import { Schema } from "effect";

export const InactivityPolicy = Schema.Struct({
  enabled: Schema.Boolean,
  days: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 365 })),
});
export type InactivityPolicy = typeof InactivityPolicy.Type;
