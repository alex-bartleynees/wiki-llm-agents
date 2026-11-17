import { Schema } from "effect";

/** GET /api/secrets */
export const ListSecretsRequest = Schema.Struct({});
export type ListSecretsRequest = typeof ListSecretsRequest.Type;
