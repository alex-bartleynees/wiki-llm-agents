import { describe, expect, it } from "vitest";
import { fuzzyMatch, normaliseFuzzyQuery } from "./fuzzy.js";

const match = (query: string, text: string) => fuzzyMatch(normaliseFuzzyQuery(query), text);
const marked = (query: string, text: string) => {
  const result = match(query, text);
  if (result === undefined) return undefined;
  return [...text].map((char, index) => (result.positions.includes(index) ? char.toUpperCase() : char.toLowerCase())).join("");
};

describe("fuzzyMatch", () => {
  it("matches the query's characters in order, ignoring case and spaces", () => {
    expect(match("efs", "Effect Server")).toBeDefined();
    expect(match("eff serv", "Effect Server")).toBeDefined();
    expect(match("EFFECT", "effect")).toBeDefined();
    expect(match("sfe", "Effect Server")).toBeUndefined();
    expect(match("effects", "Effect")).toBeUndefined();
    expect(match("", "Effect")).toBeUndefined();
  });

  it("prefers word starts and runs of characters over scattered ones", () => {
    expect(marked("es", "Effect Server")).toBe("Effect Server");
    expect(marked("serv", "observe the Server")).toBe("observe the SERVer");
    expect(marked("rr", "Rust Rover")).toBe("Rust Rover");
    expect(marked("ip", "1-Active/Implementation Plan.md")).toBe("1-active/Implementation Plan.md");
    expect(marked("wla", "Wiki-LLM-Agents-App")).toBe("Wiki-Llm-Agents-app");
  });

  it("matches camelCase humps as word starts", () => {
    expect(marked("ls", "listSessions")).toBe("ListSessions");
  });

  it("ranks prefixes and word starts above matches in the middle of words", () => {
    const score = (query: string, text: string) => match(query, text)?.score ?? -Infinity;
    expect(score("plan", "Plan")).toBeGreaterThan(score("plan", "Explanation"));
    expect(score("ip", "Implementation Plan")).toBeGreaterThan(score("ip", "Shipping"));
    expect(score("note", "Note")).toBeGreaterThan(score("note", "Notebook"));
    expect(score("rag", "RAG Layer")).toBeGreaterThan(score("rag", "Storage"));
    // A run that starts a word beats the same letters scattered over word starts.
    expect(score("rag", "RAG Layer with rag-ai")).toBeGreaterThan(score("rag", "Recipes and Guided Brew Plan"));
    expect(score("plan", "Implementation Plan")).toBeGreaterThan(score("plan", "Pi Layer And Notes"));
  });

  it("returns positions that index into the original text", () => {
    expect(match("işlem", "İşlem")?.positions).toEqual([0, 1, 2, 3, 4]);
  });
});
