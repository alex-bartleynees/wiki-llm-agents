import { Schema } from "effect";

/** GET /api/agents */
export const ListAgentsRequest = Schema.Struct({});
export type ListAgentsRequest = typeof ListAgentsRequest.Type;
