import { describe, expect, it } from "vitest";
import type { OpenCodeEvent } from "./api.js";
import { approvalPrompt, formAnswer, makeTurnMapper, questionPrompt, sessionOf, summariseInput } from "./events.js";

type EventOf<T extends OpenCodeEvent["type"]> = Extract<OpenCodeEvent, { readonly type: T }>;

/** Builds an event's data only; the mapper reads nothing else. */
const event = <T extends OpenCodeEvent["type"]>(type: T, data: unknown) => ({ id: "evt_1", type, data }) as unknown as EventOf<T>;

describe("summariseInput", () => {
  it("titles a command", () => {
    const asked = event("permission.asked", { id: "per_1", sessionID: "ses_1", action: "shell", resources: ["ls Notes"] });
    expect(approvalPrompt(asked)).toEqual({ _tag: "approval", title: "Run ls Notes", detail: "ls Notes" });
  });

  it.each([
    [{ path: "/vault/Notes/Tea.md" }, "Notes/Tea.md"],
    [{ filePath: "/elsewhere/x.md" }, "/elsewhere/x.md"],
    [{ command: "ls -la" }, "ls -la"],
    [{ pattern: "**/*.md" }, "**/*.md"],
    [{}, ""],
    [{ questions: [1] }, '{"questions":[1]}'],
  ])("%j → %s", (input, summary) => {
    expect(summariseInput(input, "/vault")).toBe(summary);
  });

  it("keeps long inputs short", () => {
    expect(summariseInput({ command: "x".repeat(1000) }, "/vault")).toHaveLength(300);
  });
});

describe("approvalPrompt", () => {
  it("shows a command when there is no diff", () => {
    const asked = event("permission.asked", {
      id: "per_1",
      sessionID: "ses_1",
      action: "bash",
      resources: ["git status"],
      metadata: { command: "git status" },
    });
    expect(approvalPrompt(asked)).toEqual({ _tag: "approval", title: "Run git status", detail: "git status" });
  });

  it("gives each file's patch as a proposed edit", () => {
    const patch = "--- Notes/Tea.md\n+++ Notes/Tea.md\n@@ -1,1 +1,2 @@\n # Tea\n+Oolong too.\n";
    const asked = event("permission.asked", {
      id: "per_1",
      sessionID: "ses_1",
      action: "edit",
      resources: ["Notes/Tea.md"],
      metadata: { files: [{ file: "Notes/Tea.md", patch, status: "modified" }] },
    });
    expect(approvalPrompt(asked)).toEqual({
      _tag: "approval",
      title: "Edit Notes/Tea.md",
      detail: patch,
      edits: [{ path: "Notes/Tea.md", patch, warnings: [] }],
    });
  });

  it("names actions it doesn't know", () => {
    const asked = event("permission.asked", { id: "per_1", sessionID: "ses_1", action: "lsp", resources: ["a.ts"] });
    expect(approvalPrompt(asked)).toEqual({ _tag: "approval", title: "Use lsp on a.ts", detail: "a.ts" });
  });
});

describe("questionPrompt", () => {
  const form = (fields: ReadonlyArray<unknown>) =>
    event("form.created", { form: { id: "frm_1", sessionID: "ses_1", title: "Questions", fields } });

  it("asks one question with its options", () => {
    const created = form([{ key: "q0", type: "string", description: "Which tea?", options: [{ value: "a", label: "Assam" }] }]);
    expect(questionPrompt(created)).toEqual({ _tag: "question", question: "Which tea?", options: ["Assam"] });
    expect(sessionOf(created)).toBe("ses_1");
  });

  it("numbers several questions and gives your answer to each", () => {
    const created = form([
      { key: "q0", type: "string", description: "Which tea?" },
      { key: "q1", type: "string", title: "Milk?" },
    ]);
    expect(questionPrompt(created)).toEqual({ _tag: "question", question: "1. Which tea?\n2. Milk?", options: [] });
    expect(formAnswer(created, "Assam, no milk")).toEqual({ q0: "Assam, no milk", q1: "Assam, no milk" });
  });
});

describe("makeTurnMapper", () => {
  it("adds up every step's tokens, cached input included", () => {
    const mapper = makeTurnMapper("turn-1", "/vault");
    const step = { cost: 0.01, tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 100, write: 1 } } };
    mapper.map(event("session.step.ended", { sessionID: "ses_1", ...step }));
    mapper.map(event("session.step.failed", { sessionID: "ses_1", ...step, error: { type: "aborted", message: "x" } }));
    expect(mapper.map(event("session.execution.succeeded", { sessionID: "ses_1" }))).toEqual([
      { _tag: "turn.finished", turnId: "turn-1", outcome: "completed", usage: { inputTokens: 222, outputTokens: 14, costUsd: 0.02 }, reason: null },
    ]);
  });

  it("says why OpenCode failed or stopped a turn you didn't stop", () => {
    const mapper = makeTurnMapper("turn-1", "/vault");
    const failed = mapper.map(event("session.execution.failed", { sessionID: "ses_1", error: { type: "api", message: "Rate limited" } }));
    expect(failed[0]).toMatchObject({ outcome: "failed", reason: "Rate limited" });
    const stopped = mapper.map(event("session.execution.interrupted", { sessionID: "ses_1", reason: "shutdown" }));
    expect(stopped[0]).toMatchObject({ outcome: "interrupted", reason: "OpenCode stopped the turn (shutdown)." });
  });

  it("reports the files a writing tool writes, from its input and its result", () => {
    const mapper = makeTurnMapper("turn-1", "/vault");
    mapper.map(event("session.tool.input.started", { sessionID: "ses_1", id: "call_1", name: "edit" }));
    expect(mapper.map(event("session.tool.called", { sessionID: "ses_1", id: "call_1", input: { path: "Notes/Tea.md", oldString: "a", newString: "b" } }))).toEqual([
      { _tag: "tool.called", turnId: "turn-1", callId: "call_1", name: "edit", input: "Notes/Tea.md", writes: ["/vault/Notes/Tea.md"] },
    ]);
    const success = event("session.tool.success", {
      sessionID: "ses_1",
      id: "call_1",
      content: [{ type: "text", text: "Edited" }],
      metadata: { files: [{ file: "Notes/Tea.md", patch: "", status: "modified" }] },
    });
    expect(mapper.map(success)).toEqual([
      { _tag: "tool.finished", turnId: "turn-1", callId: "call_1", status: "succeeded", output: "Edited", writes: ["/vault/Notes/Tea.md"] },
    ]);
  });

  it("reports every file an apply_patch call names", () => {
    const mapper = makeTurnMapper("turn-1", "/vault");
    mapper.map(event("session.tool.input.started", { sessionID: "ses_1", id: "call_1", name: "apply_patch" }));
    const patchText = "*** Begin Patch\n*** Update File: a.md\n@@\n-x\n+y\n*** Add File: /elsewhere/b.md\n+z\n*** End Patch";
    const [called] = mapper.map(event("session.tool.called", { sessionID: "ses_1", id: "call_1", input: { patchText } }));
    expect(called).toMatchObject({ writes: ["/vault/a.md", "/elsewhere/b.md"] });
  });

  it("reports no writes for tools that only read", () => {
    const mapper = makeTurnMapper("turn-1", "/vault");
    mapper.map(event("session.tool.input.started", { sessionID: "ses_1", id: "call_1", name: "read" }));
    const [called] = mapper.map(event("session.tool.called", { sessionID: "ses_1", id: "call_1", input: { path: "a.md" } }));
    expect(called).not.toHaveProperty("writes");
  });

  it("names a tool call from its input-started event", () => {
    const mapper = makeTurnMapper("turn-1", "/vault");
    mapper.map(event("session.tool.input.started", { sessionID: "ses_1", id: "call_1", name: "read" }));
    expect(mapper.map(event("session.tool.called", { sessionID: "ses_1", id: "call_1", input: { path: "/vault/a.md" } }))).toEqual([
      { _tag: "tool.called", turnId: "turn-1", callId: "call_1", name: "read", input: "a.md" },
    ]);
  });
});
