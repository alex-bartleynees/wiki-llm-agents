import type { McpConnection } from "@wiki-agents/contracts/mcp-oauth/model";
import type { McpServerSummary } from "@wiki-agents/contracts/mcp-servers/model";
import { describe, expect, it } from "vitest";
import { canSignIn, connectionText, connectLabel } from "./connection.ts";

const server = (transport: McpServerSummary["transport"]): McpServerSummary => ({
  id: "s",
  path: "/c/mcp/s.yaml",
  title: "S",
  transport,
  scope: "app",
  default: false,
  access: null,
  oauth: null,
  excludeTools: [],
  browserSignIns: false,
  builtIn: false,
});

const connection = (extra: Partial<McpConnection>): McpConnection => ({
  serverId: "s",
  state: "connected",
  connectedAt: 1,
  expiresAt: 2,
  renews: true,
  scopes: [],
  issuer: null,
  problem: null,
  ...extra,
});

describe("sign-in", () => {
  it("is offered for URL servers without their own Authorization header", () => {
    expect(canSignIn(server({ type: "http", url: "https://x", headers: {} }))).toBe(true);
    expect(canSignIn(server({ type: "http", url: "https://x", headers: { authorization: "Bearer ${secret:x}" } }))).toBe(false);
    expect(canSignIn(server({ type: "stdio", command: "x", args: [], env: {}, cwd: null }))).toBe(false);
  });

  it("words each state, and offers Reconnect once signed in", () => {
    expect(connectionText(connection({}))).toBe("Signed in; renewed automatically");
    expect(connectionText(connection({ renews: false }))).toBe("Signed in");
    expect(connectionText(connection({ state: "expired" }))).toBe("Sign-in ran out; connect again");
    expect(connectionText(connection({ state: "disconnected" }))).toBe("Not signed in");
    expect(connectLabel(undefined)).toBe("Connect");
    expect(connectLabel(connection({ state: "disconnected" }))).toBe("Connect");
    expect(connectLabel(connection({ state: "expired" }))).toBe("Reconnect");
  });
});
