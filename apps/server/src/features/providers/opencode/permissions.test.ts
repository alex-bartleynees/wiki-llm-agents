import { type Autonomy, DEFAULT_AUTONOMY } from "@wiki-agents/contracts/agents/model";
import { describe, expect, it } from "vitest";
import type { OpenCodePermissionRule } from "./api.js";
import { enforcedAutonomy, permissionRules } from "./permissions.js";

/** What OpenCode decides for an action: the last matching rule wins. */
const decide = (rules: ReadonlyArray<OpenCodePermissionRule>, action: string) =>
  rules.findLast((rule) => rule.action === "*" || rule.action === action)?.effect;

const ACTIONS = ["read", "glob", "grep", "edit", "write", "shell", "webfetch", "websearch", "question", "todowrite", "external_directory", "subagent", "some_mcp_tool"];

const decisions = (autonomy: Autonomy) => {
  const rules = permissionRules(autonomy);
  return Object.fromEntries(ACTIONS.map((action) => [action, decide(rules, action)]));
};

describe("autonomy → OpenCode permission rules", () => {
  it("starts with the catch-all ask, so anything unlisted asks", () => {
    expect(permissionRules(DEFAULT_AUTONOMY)[0]).toEqual({ action: "*", resource: "*", effect: "ask" });
  });

  it.each<[string, Autonomy, Record<string, string>]>([
    [
      "no agent: read freely, ask for the rest",
      DEFAULT_AUTONOMY,
      { read: "allow", glob: "allow", grep: "allow", edit: "ask", write: "ask", shell: "ask", webfetch: "ask", websearch: "ask" },
    ],
    [
      "researcher: create allowed but edit asks, so both ask",
      { read: "allow", create: "allow", edit: "ask", commands: "deny", web: "allow" },
      { read: "allow", edit: "ask", write: "ask", shell: "deny", webfetch: "allow", websearch: "allow" },
    ],
    [
      "reviewer: no writes or commands, web asks",
      { read: "allow", create: "deny", edit: "deny", commands: "deny", web: "ask" },
      { read: "allow", edit: "deny", write: "deny", shell: "deny", webfetch: "ask" },
    ],
    [
      "trusted: everything allowed",
      { read: "allow", create: "allow", edit: "allow", commands: "allow", web: "allow" },
      { read: "allow", edit: "allow", shell: "allow", webfetch: "allow" },
    ],
    [
      "edit denied but create allowed: both denied",
      { read: "ask", create: "allow", edit: "deny", commands: "ask", web: "deny" },
      { read: "ask", grep: "ask", edit: "deny", write: "deny", shell: "ask", webfetch: "deny", websearch: "deny" },
    ],
  ])("%s", (_name, autonomy, expected) => {
    expect(decisions(autonomy)).toMatchObject(expected);
  });

  it("always allows talking to you and planning, and always asks outside the folder, for subagents and unknown tools", () => {
    const strict = decisions({ read: "deny", create: "deny", edit: "deny", commands: "deny", web: "deny" });
    const open = decisions({ read: "allow", create: "allow", edit: "allow", commands: "allow", web: "allow" });
    for (const decided of [strict, open]) {
      expect(decided).toMatchObject({ question: "allow", todowrite: "allow", external_directory: "ask", subagent: "ask", some_mcp_tool: "ask" });
    }
  });
});

describe("enforcedAutonomy", () => {
  it("says when create and edit differ, and gives both the stricter level", () => {
    const enforced = enforcedAutonomy({ read: "allow", create: "allow", edit: "ask", commands: "deny", web: "allow" });
    expect(enforced.autonomy).toEqual({ read: "allow", create: "ask", edit: "ask", commands: "deny", web: "allow" });
    expect(enforced.notes[0]).toMatch(/can't tell creating a file from editing one, so both ask first/);
  });

  it("only notes the working folder when create and edit agree", () => {
    const enforced = enforcedAutonomy(DEFAULT_AUTONOMY);
    expect(enforced.autonomy).toEqual(DEFAULT_AUTONOMY);
    expect(enforced.notes).toEqual([expect.stringMatching(/outside the working folder/)]);
  });
});
