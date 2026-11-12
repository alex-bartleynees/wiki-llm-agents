import { Schema } from "effect";

/** GET /api/notifications/push-key: the VAPID public key browsers subscribe with (base64url). */
export const GetPushKeyResponse = Schema.Struct({ publicKey: Schema.String });
export type GetPushKeyResponse = typeof GetPushKeyResponse.Type;
