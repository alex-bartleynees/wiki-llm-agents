import { Schema } from "effect";

/** GET /api/mcp-servers */
export const ListMcpServersRequest = Schema.Struct({});
export type ListMcpServersRequest = typeof ListMcpServersRequest.Type;
