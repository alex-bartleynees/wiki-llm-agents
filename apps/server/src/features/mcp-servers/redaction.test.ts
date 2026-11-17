import { describe, expect, it } from "vitest";
import { makeRedactor, redactJson } from "./redaction.js";

describe("makeRedactor", () => {
  it("replaces every value, the longer of two overlapping ones whole", () => {
    const redact = makeRedactor(["ghp_abcdef", "ghp_abcdef-longer"]);
    expect(redact("a ghp_abcdef-longer and ghp_abcdef")).toBe("a [redacted] and [redacted]");
  });

  it("also replaces a value as JSON writes it inside a string", () => {
    const redact = makeRedactor(['to"ken\\x']);
    expect(redact(JSON.stringify({ header: 'to"ken\\x' }))).toBe('{"header":"[redacted]"}');
  });

  it("leaves very short values and text without secrets alone", () => {
    expect(makeRedactor(["ab"])("abc")).toBe("abc");
    expect(makeRedactor([])("anything")).toBe("anything");
    expect(makeRedactor(["a.b*c"])("aXbbc a.b*c")).toBe("aXbbc [redacted]");
  });
});

describe("redactJson", () => {
  it("redacts strings at any depth, keys included, and keeps other values", () => {
    const redact = makeRedactor(["secret-value"]);
    expect(redactJson({ content: [{ type: "text", text: "is secret-value" }], n: 1, ok: true, none: null, ["secret-value"]: "x" }, redact)).toEqual({
      content: [{ type: "text", text: "is [redacted]" }],
      n: 1,
      ok: true,
      none: null,
      "[redacted]": "x",
    });
  });
});
