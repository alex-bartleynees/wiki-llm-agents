import type { McpServerStatus } from "@wiki-agents/contracts/mcp-servers/model";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** How the app's connections to a server are doing, in a few words, for its line in the list. */
export const statusText = (status: McpServerStatus): string => {
  const tools = status.tools === null ? null : count(status.tools.length, "tool", "tools");
  switch (status.state) {
    case "connected":
      return `Connected${status.connections > 1 ? ` (${count(status.connections, "connection", "connections")})` : ""}${tools === null ? "" : ` · ${tools}`}`;
    case "failed":
      return status.retryAt === null ? "Can't connect" : "Can't connect; waiting before trying again (Restart tries now)";
    case "idle":
      return tools === null ? "Not connected yet; Test lists its tools" : `Not connected now · ${tools} when last listed`;
  }
};
