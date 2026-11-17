import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { deleteMcpServerEndpoint } from "./delete-mcp-server/endpoint.js";
import { getMcpServerEndpoint } from "./get-mcp-server/endpoint.js";
import { listMcpServersEndpoint } from "./list-mcp-servers/endpoint.js";
import { restartMcpServerEndpoint } from "./restart-mcp-server/endpoint.js";
import { saveMcpServerEndpoint } from "./save-mcp-server/endpoint.js";
import { testMcpServerEndpoint } from "./test-mcp-server/endpoint.js";

export const mcpServersRouter = Layer.mergeAll(
  HttpRouter.add("GET", "/api/mcp-servers", listMcpServersEndpoint),
  HttpRouter.add("GET", "/api/mcp-servers/:serverId", getMcpServerEndpoint),
  HttpRouter.add("PUT", "/api/mcp-servers/:serverId", saveMcpServerEndpoint),
  HttpRouter.add("DELETE", "/api/mcp-servers/:serverId", deleteMcpServerEndpoint),
  HttpRouter.add("POST", "/api/mcp-servers/:serverId/test", testMcpServerEndpoint),
  HttpRouter.add("POST", "/api/mcp-servers/:serverId/restart", restartMcpServerEndpoint),
);
