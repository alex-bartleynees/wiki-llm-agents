import { Schema } from "effect";

export const SubscribeResponse = Schema.Struct({ subscriptionId: Schema.String });
export type SubscribeResponse = typeof SubscribeResponse.Type;
