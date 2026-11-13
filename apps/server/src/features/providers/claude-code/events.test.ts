import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { answeredInput, applyReplacements, askedQuestions, makeTurnMapper, questionPrompt, summariseInput, toolLabel } from "./events.js";

describe("Claude Code events", () => {
  it("applies Edit replacements as Claude Code would, and refuses a string that isn't there", () => {
    expect(applyReplacements("a b a", [{ old_string: "a", new_string: "c" }])).toBe("c b a");
    expect(applyReplacements("a b a", [{ old_string: "a", new_string: "$&", replace_all: true }])).toBe("$& b $&");
    expect(applyReplacements("a", [{ old_string: "z", new_string: "c" }])).toBeUndefined();
  });

  it("asks one question per call: several become one numbered question, answered for each", () => {
    const input = {
      questions: [
        { question: "Which tea?", header: "Tea", options: [{ label: "Sencha", description: "" }, { label: "Earl Grey", description: "" }], multiSelect: false },
        { question: "Milk?", header: "Milk", options: [{ label: "Yes", description: "" }, { label: "No", description: "" }], multiSelect: false },
      ],
    };
    expect(questionPrompt(askedQuestions({ questions: [input.questions[0]] }))).toEqual({ _tag: "question", question: "Which tea?", options: ["Sencha", "Earl Grey"] });
    expect(questionPrompt(askedQuestions(input))).toEqual({ _tag: "question", question: "1. Which tea?\n2. Milk?", options: [] });
    expect(answeredInput(input, "Sencha, no milk").answers).toEqual({ "Which tea?": "Sencha, no milk", "Milk?": "Sencha, no milk" });
  });

  it("shows paths relative to the working folder", () => {
    expect(summariseInput({ file_path: "/vault/Notes/Tea.md" }, "/vault")).toBe("Notes/Tea.md");
    expect(summariseInput({ file_path: "/elsewhere/x.md" }, "/vault")).toBe("/elsewhere/x.md");
    expect(summariseInput({ command: "ls -la" }, "/vault")).toBe("ls -la");
  });

  it("shows the vault tools by their own names, and other MCP tools with their server", () => {
    expect(toolLabel("mcp__wiki-agents-f4006d43-287c-483a-8d0a-13fc02ae82bf__vault_search")).toBe("vault_search");
    expect(toolLabel("mcp__github__create_issue")).toBe("github: create_issue");
    expect(toolLabel("Edit")).toBe("Edit");
  });

  it("sends a reply that arrives only whole, and leaves out subagents' text", () => {
    const mapper = makeTurnMapper("turn", "/vault", () => null);
    const assistant = (id: string, parent: string | null) =>
      ({ type: "assistant", parent_tool_use_id: parent, message: { id, content: [{ type: "text", text: `from ${id}` }] } }) as unknown as SDKMessage;
    expect(mapper.map(assistant("m1", null))).toEqual([{ _tag: "message.delta", turnId: "turn", messageId: "m1:0", text: "from m1" }]);
    expect(mapper.map(assistant("m2", "toolu_1"))).toEqual([]);
  });

  it("fails the turn with Claude Code's reason when the result is an error", () => {
    const mapper = makeTurnMapper("turn", "/vault", () => 0.01);
    const usage = { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 };
    const result = { type: "result", subtype: "success", is_error: true, result: "API Error: overloaded", usage, total_cost_usd: 0.01 } as unknown as SDKMessage;
    expect(mapper.map(result)).toEqual([
      { _tag: "turn.finished", turnId: "turn", outcome: "failed", usage: { inputTokens: 8, outputTokens: 2, costUsd: 0.01 }, reason: "API Error: overloaded" },
    ]);
  });

  it("shows TodoWrite as the turn's plan, not as a tool, and leaves out its result", () => {
    const mapper = makeTurnMapper("turn", "/vault", () => null);
    const todos = [
      { content: "Read the notes", status: "completed", activeForm: "Reading the notes" },
      { content: "Draft", status: "in_progress", activeForm: "Drafting" },
    ];
    const call = { type: "assistant", parent_tool_use_id: null, message: { id: "m1", content: [{ type: "tool_use", id: "toolu_1", name: "TodoWrite", input: { todos } }] } } as unknown as SDKMessage;
    expect(mapper.map(call)).toEqual([
      { _tag: "plan.updated", turnId: "turn", steps: [{ text: "Read the notes", status: "completed" }, { text: "Draft", status: "in_progress" }] },
    ]);
    const result = { type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "Todos updated" }] } } as unknown as SDKMessage;
    expect(mapper.map(result)).toEqual([]);
    const subagent = { type: "assistant", parent_tool_use_id: "toolu_9", message: { id: "m2", content: [{ type: "tool_use", id: "toolu_2", name: "TodoWrite", input: { todos } }] } } as unknown as SDKMessage;
    expect(mapper.map(subagent)).toMatchObject([{ _tag: "tool.called", name: "TodoWrite" }]);
  });
});
