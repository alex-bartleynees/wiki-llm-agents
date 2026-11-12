import { describe, expect, it } from "vitest";
import { wikilinkQuery, wikilinkTarget } from "./wikilinks.ts";

describe("wikilinkTarget", () => {
  const paths = ["index.md", "Projects/Plan.md", "Archive/Plan.md", "Archive/2025/Plan.md", "assets/diagram.png", "Effect 4.1.md"];

  it("uses the file name when no other file has it, without .md for notes", () => {
    expect(wikilinkTarget("index.md", paths)).toBe("index");
    expect(wikilinkTarget("Effect 4.1.md", paths)).toBe("Effect 4.1");
    expect(wikilinkTarget("assets/diagram.png", paths)).toBe("diagram.png");
  });

  it("adds folders until the link is unambiguous, or uses the whole path", () => {
    expect(wikilinkTarget("Projects/Plan.md", paths)).toBe("Projects/Plan");
    expect(wikilinkTarget("Archive/2025/Plan.md", paths)).toBe("2025/Plan");
    expect(wikilinkTarget("Archive/Plan.md", paths)).toBe("Archive/Plan");
  });

  it("ignores case, as link resolution does", () => {
    expect(wikilinkTarget("Notes/plan.md", ["Notes/plan.md", "Other/PLAN.md"])).toBe("Notes/plan");
  });
});

describe("wikilinkQuery", () => {
  it("finds the link being typed and where its target starts", () => {
    expect(wikilinkQuery("See [[Pla")).toEqual({ from: 6, query: "Pla", embed: false });
    expect(wikilinkQuery("![[")).toEqual({ from: 3, query: "", embed: true });
    expect(wikilinkQuery("[[Folder/No")).toEqual({ from: 2, query: "Folder/No", embed: false });
  });

  it("stops at a finished link, an alias or a heading", () => {
    expect(wikilinkQuery("[[Plan]] and")).toBeUndefined();
    expect(wikilinkQuery("[[Plan|the pl")).toBeUndefined();
    expect(wikilinkQuery("[[Plan#Next")).toBeUndefined();
    expect(wikilinkQuery("[single")).toBeUndefined();
  });
});
