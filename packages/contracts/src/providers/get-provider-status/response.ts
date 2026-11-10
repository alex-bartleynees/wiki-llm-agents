import { Schema } from "effect";
import { ProviderStatus } from "../model.js";

export const GetProviderStatusResponse = Schema.Struct({
  status: ProviderStatus,
});
export type GetProviderStatusResponse = typeof GetProviderStatusResponse.Type;
