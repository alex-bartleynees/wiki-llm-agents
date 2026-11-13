import type { AgentInput } from "@wiki-agents/contracts/agents/model";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { agentFileText } from "./agent-file.js";
import { DEFAULT_AGENTS } from "./default-config.js";
import { parseAgent } from "./definition.js";

const INPUT: AgentInput = {
  name: "Scout",
  description: "Looks around.",
  provider: null,
  model: null,
  sources: [],
  autonomy: { read: "allow", create: "ask", edit: "ask", commands: "deny", web: "deny" },
  concurrency: 1,
  instructions: "# Scout\n\nLook around.",
};

const parse = (text: string) => {
  const result = parseAgent("scout", "/config/agents/scout.md", text);
  if (Result.isFailure(result)) throw new Error(result.failure.join("; "));
  return result.success;
};

describe("agentFileText", () => {
  it("writes a new file the loader reads back as the same agent, leaving defaults out", () => {
    const text = agentFileText(INPUT, null);
    expect(text).toBe(`---
name: Scout
description: Looks around.
autonomy:
  read: allow
  create: ask
  edit: ask
  commands: deny
  web: deny
concurrency: 1
---

# Scout

Look around.
`);
    const { path: _, id: __, ...agent } = parse(text);
    expect(agent).toEqual(INPUT);
  });

  it("writes vault sources with their folders, and simple ones in a flow list", () => {
    expect(agentFileText({ ...INPUT, sources: ["vault", "web"] }, null)).toContain("sources: [ vault, web ]\n");
    const text = agentFileText({ ...INPUT, sources: ["web", { vault: "Notes", folders: ["Projects"] }, { vault: "Work", folders: [] }] }, null);
    expect(text).toContain("sources:\n  - web\n  - vault: Notes\n    folders:\n      - Projects\n  - vault: Work\n");
    expect(parse(text).sources).toEqual(["web", { vault: "Notes", folders: ["Projects"] }, { vault: "Work", folders: [] }]);
  });

  it("edits an existing file in place, keeping its comments, key order and settings the editor doesn't show", () => {
    const existing = DEFAULT_AGENTS["researcher"]!.replace("concurrency: 1", "concurrency: 1\ntags: [agent]");
    const text = agentFileText({ ...parse(existing.replace("name: Researcher", "name: Researcher")), ...INPUT, name: "Researcher", provider: "opencode", model: "opencode/big-pickle" }, existing);
    expect(text).toContain("# provider: opencode        # the provider new threads");
    expect(text).toContain("tags: [ agent ]");
    expect(text.indexOf("name:")).toBeLessThan(text.indexOf("description:"));
    // New settings go in their usual place, here after the description.
    expect(text).toContain("description: Looks around.\nprovider: opencode\nmodel: opencode/big-pickle\n");
    // No sources any more: the key goes, so the agent has no limits.
    expect(text).not.toMatch(/^sources:/m);
    expect(parse(text)).toMatchObject({ name: "Researcher", provider: "opencode", sources: [], autonomy: INPUT.autonomy });
  });

  it("starts the frontmatter afresh when the old one isn't a map", () => {
    expect(parse(agentFileText(INPUT, "---\n- a\n- b\n---\nOld."))).toMatchObject({ name: "Scout", instructions: "# Scout\n\nLook around." });
  });
});

describe("agentFileText, plain values", () => {
  it("changes a value in place, keeping the comment after it, and quotes text that needs it", () => {
    const existing = "---\nname: Scout # shown in the picker\ndescription: Old\n---\nOld.";
    const text = agentFileText({ ...INPUT, description: "Reads: then writes # not a comment" }, existing);
    expect(text).toContain("name: Scout # shown in the picker\n");
    expect(parse(text).description).toBe("Reads: then writes # not a comment");
  });
});
