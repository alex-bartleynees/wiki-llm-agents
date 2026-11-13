import { describe, expect, it } from "vitest";
import { changePatch, commandPrompt, makeTurnMapper, questionPrompt, unwrapShell, VAULT_SERVER } from "./events.js";
import { isSupportedVersion } from "./cli.js";

const CWD = "/vault";

describe("Codex events", () => {
  it("shows a command as typed, without the shell Codex wraps it in", () => {
    expect(unwrapShell("/run/current-system/sw/bin/zsh -lc 'mkdir Drafts'")).toBe("mkdir Drafts");
    expect(unwrapShell("bash -lc 'echo '\\''hi'\\'''")).toBe("echo 'hi'");
    expect(unwrapShell(String.raw`/bin/zsh -lc "rg --files -g '!*.git' \"x\" \$HOME"`)).toBe(String.raw`rg --files -g '!*.git' "x" $HOME`);
    expect(unwrapShell("ls -la")).toBe("ls -la");
    expect(commandPrompt({ itemId: "1", command: "/bin/bash -lc 'mkdir Drafts'", cwd: "/elsewhere", reason: "May I?" }, CWD)).toEqual({
      _tag: "approval",
      title: "Run mkdir Drafts",
      detail: "In /elsewhere\nMay I?\nmkdir Drafts",
    });
  });

  it("gives every change a unified diff with file headers", () => {
    expect(changePatch({ path: "/vault/Notes/Tea.md", kind: { type: "update", move_path: null }, diff: "@@ -3 +3,2 @@\n Green tea.\n+Oolong too." }, CWD)).toBe(
      "--- Notes/Tea.md\n+++ Notes/Tea.md\n@@ -3 +3,2 @@\n Green tea.\n+Oolong too.\n",
    );
    expect(changePatch({ path: "/vault/Notes/Oolong.md", kind: { type: "add" }, diff: "# Oolong\n" }, CWD)).toContain("+# Oolong");
    expect(changePatch({ path: "/vault/Old.md", kind: { type: "delete" }, diff: "gone\n" }, CWD)).toContain("-gone");
  });

  it("names tools by what they do, attributes a patch's writes, and adds up the turn's usage", () => {
    const mapper = makeTurnMapper("t", CWD, () => undefined);
    const command = (id: string, actions: ReadonlyArray<object>) => ({ type: "commandExecution", id, command: "zsh -lc 'x'", cwd: CWD, status: "inProgress", commandActions: actions, aggregatedOutput: null, exitCode: null }) as never;
    expect(mapper.map("item/started", { turnId: "c", item: command("1", [{ type: "read", command: "cat Notes/Tea.md", name: "Tea.md", path: "/vault/Notes/Tea.md" }]) })).toEqual([
      { _tag: "tool.called", turnId: "t", callId: "1", name: "read", input: "Notes/Tea.md" },
    ]);
    expect(mapper.map("item/started", { turnId: "c", item: { type: "mcpToolCall", id: "2", server: VAULT_SERVER, tool: "vault_search", status: "inProgress", arguments: { query: "tea" }, result: null, error: null } })).toEqual([
      { _tag: "tool.called", turnId: "t", callId: "2", name: "vault_search", input: "tea" },
    ]);
    const changes = [{ path: "/vault/A.md", kind: { type: "add" as const }, diff: "a\n" }];
    expect(mapper.map("item/started", { turnId: "c", item: { type: "fileChange", id: "3", changes, status: "inProgress" } })).toEqual([
      { _tag: "tool.called", turnId: "t", callId: "3", name: "create", input: "A.md", writes: ["/vault/A.md"] },
    ]);
    expect(mapper.fileChange("3")).toEqual(changes);
    for (const tokens of [10, 20]) mapper.map("thread/tokenUsage/updated", { turnId: "c", tokenUsage: { last: { inputTokens: tokens, cachedInputTokens: 0, outputTokens: 1 } } });
    expect(mapper.map("turn/completed", { turn: { id: "c", status: "failed", error: { message: "Usage limit reached", additionalDetails: "Try again later" } } })).toEqual([
      { _tag: "turn.finished", turnId: "t", outcome: "failed", usage: { inputTokens: 30, outputTokens: 2, costUsd: null }, reason: "Usage limit reached\nTry again later" },
    ]);
  });

  it("sends a reply whole only when it didn't stream", () => {
    const mapper = makeTurnMapper("t", CWD, () => undefined);
    mapper.map("item/agentMessage/delta", { turnId: "c", itemId: "m1", delta: "Hi" });
    expect(mapper.map("item/completed", { turnId: "c", item: { type: "agentMessage", id: "m1", text: "Hi" } })).toEqual([]);
    expect(mapper.map("item/completed", { turnId: "c", item: { type: "agentMessage", id: "m2", text: "Whole" } })).toEqual([
      { _tag: "message.delta", turnId: "t", messageId: "m2", text: "Whole" },
    ]);
  });

  it("asks one question, or several as one numbered question", () => {
    const question = (id: string, text: string) => ({ id, header: id, question: text, options: [{ label: "Yes" }] });
    expect(questionPrompt([question("a", "Tea?")])).toEqual({ _tag: "question", question: "Tea?", options: ["Yes"] });
    expect(questionPrompt([question("a", "Tea?"), question("b", "Milk?")])).toEqual({ _tag: "question", question: "1. Tea?\n2. Milk?", options: [] });
  });

  it("passes on Codex's plan updates", () => {
    const mapper = makeTurnMapper("t", CWD, () => undefined);
    const plan = [
      { step: "Read", status: "completed" as const },
      { step: "Write", status: "inProgress" as const },
      { step: "Check", status: "pending" as const },
    ];
    expect(mapper.map("turn/plan/updated", { turnId: "c", explanation: null, plan })).toEqual([
      {
        _tag: "plan.updated",
        turnId: "t",
        steps: [
          { text: "Read", status: "completed" },
          { text: "Write", status: "in_progress" },
          { text: "Check", status: "pending" },
        ],
      },
    ]);
  });

  it("accepts Codex 0.166.0 and later 0.x releases", () => {
    expect(isSupportedVersion("0.166.0")).toBe(true);
    expect(isSupportedVersion("0.170.2")).toBe(true);
    expect(isSupportedVersion("0.165.9")).toBe(false);
    expect(isSupportedVersion("1.0.0")).toBe(false);
  });
});
