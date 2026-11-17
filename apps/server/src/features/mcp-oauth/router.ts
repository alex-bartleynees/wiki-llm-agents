import { OAUTH_CALLBACK_PATH } from "@wiki-agents/contracts/mcp-oauth/model";
import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { disconnectEndpoint } from "./disconnect/endpoint.js";
import { finishConnectEndpoint } from "./finish-connect/endpoint.js";
import { listConnectionsEndpoint } from "./list-connections/endpoint.js";
import { oauthCallbackEndpoint } from "./oauth-callback/endpoint.js";
import { startConnectEndpoint } from "./start-connect/endpoint.js";

/** Signing in to MCP servers; no route returns a token. */
export const mcpOAuthRouter = Layer.mergeAll(
  HttpRouter.add("GET", "/api/mcp-servers/oauth/connections", listConnectionsEndpoint),
  HttpRouter.add("POST", "/api/mcp-servers/oauth/finish", finishConnectEndpoint),
  HttpRouter.add("GET", OAUTH_CALLBACK_PATH, oauthCallbackEndpoint),
  HttpRouter.add("POST", "/api/mcp-servers/:serverId/connect", startConnectEndpoint),
  HttpRouter.add("DELETE", "/api/mcp-servers/:serverId/connection", disconnectEndpoint),
);
