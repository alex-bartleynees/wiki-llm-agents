import { DEFAULT_AUTONOMY } from "@wiki-agents/contracts/agents/model";
import { Schema } from "effect";
import { McpSchema } from "effect/ai";
import { describe, expect, it } from "vitest";
import { approvalPrompt, MAX_APPROVAL_ARGUMENTS, MAX_RESULT_TEXT, toolCallLevel, toolsOf, truncateResult } from "./gateway.js";

/** A tool as a server lists it, decoded as the pool decodes it. */
const tool = (name: string, annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }) =>
  Schema.decodeUnknownSync(McpSchema.Tool)({ name, inputSchema: { type: "object" }, ...(annotations === undefined ? {} : { annotations }) });

const server = { id: "github", title: "GitHub", access: null, browserSignIns: false };

describe("toolCallLevel", () => {
  const autonomy = { ...DEFAULT_AUTONOMY, read: "allow" as const, tools: "deny" as const };

  it("reads read-only tools on `read` and everything else on `tools`", () => {
    expect(toolCallLevel(autonomy, { access: null, tool: tool("list_issues", { readOnlyHint: true }) })).toBe("allow");
    expect(toolCallLevel(autonomy, { access: null, tool: tool("create_issue", { readOnlyHint: false }) })).toBe("deny");
    // No annotations at all: MCP says assume it may change things.
    expect(toolCallLevel(autonomy, { access: null, tool: tool("mystery") })).toBe("deny");
  });

  it("puts a server's access in place of the agent's level for all its tools", () => {
    expect(toolCallLevel(autonomy, { access: "allow", tool: tool("create_issue") })).toBe("allow");
    expect(toolCallLevel(autonomy, { access: "ask", tool: tool("list_issues", { readOnlyHint: true }) })).toBe("ask");
  });
});

describe("toolsOf", () => {
  it("gives tools that aren't read-only too, keeping the server's access with each", () => {
    const { given, heldBack } = toolsOf({ ...server, access: "ask" }, [tool("list_issues", { readOnlyHint: true }), tool("create_issue"), tool("bad name!")]);
    expect(given.map(({ name, access }) => [name, access])).toEqual([["github__list_issues", "ask"], ["github__create_issue", "ask"]]);
    expect(heldBack.map(({ name }) => name)).toEqual(["bad name!"]);
  });
});

describe("approvalPrompt", () => {
  it("names the server and tool, says it may change things, and shows the arguments", () => {
    const prompt = approvalPrompt({ serverId: "github", serverTitle: "GitHub", tool: tool("create_issue") }, { title: "Bug" });
    expect(prompt.title).toBe("GitHub: create_issue");
    expect(prompt.detail).toContain("MCP server github, tool create_issue.");
    expect(prompt.detail).toContain("may change or delete");
    expect(prompt.detail).toContain('"title": "Bug"');
  });

  it("leaves the warning out for additive tools, and cuts long arguments saying how much", () => {
    const prompt = approvalPrompt({ serverId: "github", serverTitle: "GitHub", tool: tool("add_comment", { destructiveHint: false }) }, { body: "x".repeat(MAX_APPROVAL_ARGUMENTS * 2) });
    expect(prompt.detail).not.toContain("may change or delete");
    expect(prompt.detail).toMatch(/more characters not shown\)$/);
    expect(prompt.detail.length).toBeLessThan(MAX_APPROVAL_ARGUMENTS + 200);
  });
});

describe("truncateResult", () => {
  it("returns a short result as it is, and cuts long text blocks saying so", () => {
    const short = { content: [{ type: "text", text: "fine" }] };
    expect(truncateResult(short)).toBe(short);
    const cut = truncateResult({ content: [{ type: "text", text: "a".repeat(MAX_RESULT_TEXT + 10) }, { type: "image", data: "", mimeType: "image/png" }], isError: false });
    expect(cut.content[0]).toMatchObject({ type: "text", text: expect.stringMatching(/cut by wiki-agents: 10 more characters/) });
    expect(cut.content[1]).toEqual({ type: "image", data: "", mimeType: "image/png" });
    expect(cut.isError).toBe(false);
  });
});
