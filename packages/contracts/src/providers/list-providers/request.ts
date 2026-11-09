import { Schema } from "effect";

/** GET /api/providers */
export const ListProvidersRequest = Schema.Struct({});
export type ListProvidersRequest = typeof ListProvidersRequest.Type;
