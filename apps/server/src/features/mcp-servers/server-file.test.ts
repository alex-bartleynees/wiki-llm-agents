import type { McpServerInput } from "@wiki-agents/contracts/mcp-servers/model";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { parseMcpServer } from "./definition.js";
import { mcpServerFileText } from "./server-file.js";

const GITHUB: McpServerInput = {
  title: "GitHub",
  transport: { type: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer ${secret:github}" } },
  scope: "app",
  default: false,
  access: null,
};

describe("mcpServerFileText", () => {
  it("writes a new http server", () => {
    expect(mcpServerFileText(GITHUB, null)).toBe(
      "title: GitHub\ntransport:\n  type: http\n  url: https://api.githubcopilot.com/mcp/\n  headers:\n    Authorization: Bearer ${secret:github}\nscope: app\ndefault: false\n",
    );
  });

  it("leaves out what a stdio server doesn't set", () => {
    const text = mcpServerFileText({ ...GITHUB, transport: { type: "stdio", command: " github-mcp-server ", args: [], env: {}, cwd: null }, access: "ask" }, null);
    expect(text).toBe("title: GitHub\ntransport:\n  type: stdio\n  command: github-mcp-server\nscope: app\ndefault: false\naccess: ask\n");
  });

  it("reads back what it wrote", () => {
    const input: McpServerInput = {
      title: "Browser",
      transport: { type: "stdio", command: "npx", args: ["-y", "@playwright/mcp", "--port=0"], env: { TOKEN: "${env:BROWSER_TOKEN}", EMPTY: "" }, cwd: "/srv/my browser" },
      scope: "thread",
      default: true,
      access: "deny",
    };
    const parsed = parseMcpServer("browser", "/config/mcp/browser.yaml", mcpServerFileText(input, null));
    expect(Result.getOrThrow(parsed)).toEqual({ id: "browser", path: "/config/mcp/browser.yaml", ...input });
  });

  it("edits a file in place: comments and order stay, and a removed setting goes", () => {
    const existing = "# GitHub's hosted server\nscope: project\naccess: ask\n# who gets it\ndefault: true\ntransport:\n  type: stdio\n  command: old\ntitle: Old\n";
    expect(mcpServerFileText(GITHUB, existing)).toBe(
      "# GitHub's hosted server\nscope: app\n# who gets it\ndefault: false\ntransport:\n  type: http\n  url: https://api.githubcopilot.com/mcp/\n  headers:\n    Authorization: Bearer ${secret:github}\ntitle: GitHub\n",
    );
  });

  it("starts again from a file that isn't a set of settings", () => {
    expect(mcpServerFileText(GITHUB, "- a\n- b\n")).toBe(mcpServerFileText(GITHUB, null));
  });
});
