import { Schema } from "effect";

export const UnsubscribeResponse = Schema.Struct({ subscriptionId: Schema.String });
export type UnsubscribeResponse = typeof UnsubscribeResponse.Type;
