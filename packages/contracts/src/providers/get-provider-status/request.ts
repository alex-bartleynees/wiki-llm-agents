import { Schema } from "effect";

/** GET /api/providers/:providerInstanceId/status. Checks without opening a session. */
export const GetProviderStatusRequest = Schema.Struct({
  providerInstanceId: Schema.String,
});
export type GetProviderStatusRequest = typeof GetProviderStatusRequest.Type;
