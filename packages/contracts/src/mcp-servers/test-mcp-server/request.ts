import { Schema } from "effect";

/**
 * POST /api/mcp-servers/:serverId/test: connects once on its own (apart from the
 * connections threads use), lists the tools and disconnects. A server that can't be
 * reached is a result (`state: failed`), not an error.
 */
export const TestMcpServerRequest = Schema.Struct({
  serverId: Schema.String,
});
export type TestMcpServerRequest = typeof TestMcpServerRequest.Type;
