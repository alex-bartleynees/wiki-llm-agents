import type { McpServerStatus } from "@wiki-agents/contracts/mcp-servers/model";
import { describe, expect, it } from "vitest";
import { statusText } from "./status.ts";

const tool = (name: string) => ({ name, title: null, description: null, readOnly: false });
const status = (extra: Partial<McpServerStatus>): McpServerStatus => ({
  serverId: "s",
  state: "idle",
  connections: 0,
  tools: null,
  listedAt: null,
  protocolVersion: null,
  problem: null,
  retryAt: null,
  ...extra,
});

describe("statusText", () => {
  it("says whether it is connected and how many tools it has", () => {
    expect(statusText(status({}))).toBe("Not connected yet; Test lists its tools");
    expect(statusText(status({ tools: [tool("a")] }))).toBe("Not connected now · 1 tool when last listed");
    expect(statusText(status({ state: "connected", connections: 1, tools: [tool("a"), tool("b")] }))).toBe("Connected · 2 tools");
    expect(statusText(status({ state: "connected", connections: 3, tools: [] }))).toBe("Connected (3 connections) · 0 tools");
  });

  it("says when it can't connect, and that Restart doesn't wait", () => {
    expect(statusText(status({ state: "failed", problem: "Down." }))).toBe("Can't connect");
    expect(statusText(status({ state: "failed", problem: "Down.", retryAt: 1 }))).toBe("Can't connect; waiting before trying again (Restart tries now)");
  });
});
