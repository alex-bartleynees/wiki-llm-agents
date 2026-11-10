import { DEFAULT_AUTONOMY } from "@wiki-agents/contracts/agents/model";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { DEFAULT_AGENTS, DEFAULT_RULES } from "./default-config.js";
import { conflictCopyProblem, parseAgent, parseRules, splitFrontmatter } from "./definition.js";

const PATH = "/config/agents/researcher.md";

const problems = (text: string, id = "researcher") => {
  const result = parseAgent(id, PATH, text);
  if (Result.isSuccess(result)) throw new Error("expected the file to be refused");
  return result.failure;
};

const agent = (text: string, id = "researcher") => {
  const result = parseAgent(id, PATH, text);
  if (Result.isFailure(result)) throw new Error(`refused: ${result.failure.join("; ")}`);
  return result.success;
};

describe("parseAgent", () => {
  it("reads every setting from the frontmatter and the body as instructions", () => {
    const parsed = agent(`---
name: Deep Researcher
description: Digs.
provider: opencode
model: opencode/big-pickle
sources: [vault, web]
autonomy:
  read: allow
  create: allow
  edit: ask
  commands: deny
  web: allow
concurrency: 2
tags: [agent]
---

# Role

Dig deep.
`);
    expect(parsed).toEqual({
      id: "researcher",
      name: "Deep Researcher",
      description: "Digs.",
      provider: "opencode",
      model: "opencode/big-pickle",
      sources: ["vault", "web"],
      autonomy: { read: "allow", create: "allow", edit: "ask", commands: "deny", web: "allow" },
      concurrency: 2,
      path: PATH,
      instructions: "# Role\n\nDig deep.",
    });
  });

  it("fills in what the file leaves out: a name from the file name, read freely, ask for the rest", () => {
    const parsed = agent("Just instructions.", "code-reviewer");
    expect(parsed).toMatchObject({ name: "Code reviewer", description: "", provider: null, model: null, sources: [], concurrency: 1 });
    expect(parsed.autonomy).toEqual(DEFAULT_AUTONOMY);
    expect(agent("---\nautonomy:\n  commands: deny\n---\nGo.").autonomy).toEqual({ ...DEFAULT_AUTONOMY, commands: "deny" });
  });

  it("takes always and never for allow and deny, as the design notes write them", () => {
    expect(agent("---\nautonomy:\n  create: always\n  commands: never\n---\nGo.").autonomy).toMatchObject({ create: "allow", commands: "deny" });
  });

  it("names the field for every problem", () => {
    const found = problems(`---
autonomy:
  edit: maybe
  comands: deny
concurrency: 0
colour: blue
---
Go.`);
    expect(found).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^autonomy\.edit: /),
        expect.stringMatching(/^autonomy\.comands: /),
        expect.stringMatching(/^concurrency: /),
        expect.stringMatching(/^colour: /),
      ]),
    );
    expect(found).toHaveLength(4);
  });

  it("refuses broken YAML, a body without instructions, and file names that aren't ids", () => {
    expect(problems("---\nname: [unclosed\n---\nGo.")[0]).toMatch(/isn't valid YAML/);
    expect(problems("---\n- a list\n---\nGo.")[0]).toMatch(/key: value/);
    expect(problems("---\nname: Empty\n---\n\n")[0]).toMatch(/no instructions/);
    expect(problems("Go.", "My Agent")[0]).toMatch(/lowercase/);
  });

  it("accepts the default agents", () => {
    for (const [id, text] of Object.entries(DEFAULT_AGENTS)) expect(Result.isSuccess(parseAgent(id, `/config/agents/${id}.md`, text))).toBe(true);
    expect(agent(DEFAULT_AGENTS["researcher"]!).autonomy).toMatchObject({ create: "allow", edit: "ask", commands: "deny" });
    expect(agent(DEFAULT_AGENTS["reviewer"]!, "reviewer").autonomy).toMatchObject({ create: "deny", edit: "deny" });
  });
});

describe("parseRules", () => {
  it("takes the body and drops any frontmatter", () => {
    expect(parseRules("wiki-llm", "/config/rules/wiki-llm.md", "---\ntags: [rules]\n---\n# Rules\n")).toEqual(
      Result.succeed({ id: "wiki-llm", path: "/config/rules/wiki-llm.md", text: "# Rules" }),
    );
    expect(Result.isFailure(parseRules("empty", "/config/rules/empty.md", "  \n"))).toBe(true);
    expect(Result.isSuccess(parseRules("wiki-llm", "/x", DEFAULT_RULES["wiki-llm"]!))).toBe(true);
  });
});

describe("splitFrontmatter", () => {
  it("handles a byte order mark, CRLF, and an unclosed block", () => {
    expect(splitFrontmatter("﻿---\r\nname: A\r\n---\r\nBody")).toEqual({ yaml: "name: A", body: "Body" });
    expect(splitFrontmatter("---\nname: A\nBody")).toEqual({ yaml: null, body: "---\nname: A\nBody" });
  });
});

describe("conflictCopyProblem", () => {
  it("names the file a Syncthing conflict copy belongs to", () => {
    expect(conflictCopyProblem("researcher.sync-conflict-20261110-120000-ABCDEFG.md")).toMatch(/^A Syncthing conflict copy of researcher\.md/);
    expect(conflictCopyProblem("researcher.md")).toBeNull();
    expect(conflictCopyProblem("code-reviewer.md")).toBeNull();
  });
});
