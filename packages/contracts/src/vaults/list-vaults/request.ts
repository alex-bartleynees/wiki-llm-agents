import { Schema } from "effect";

/**
 * GET /api/vaults takes no input today. The request is still named so the
 * operation reads Request → Endpoint → Response, and filters can be added here.
 */
export const ListVaultsRequest = Schema.Struct({});
export type ListVaultsRequest = typeof ListVaultsRequest.Type;
