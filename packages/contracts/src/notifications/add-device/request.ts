import { Schema } from "effect";

const NonEmpty = Schema.String.check(Schema.isNonEmpty());

/**
 * POST /api/notifications/devices: a browser's push subscription
 * (`PushSubscription.toJSON()`), and a name for it. Subscribing again with the same
 * endpoint updates that device and enables it again.
 */
export const AddDeviceRequest = Schema.Struct({
  endpoint: Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/)),
  keys: Schema.Struct({ p256dh: NonEmpty, auth: NonEmpty }),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
});
export type AddDeviceRequest = typeof AddDeviceRequest.Type;
