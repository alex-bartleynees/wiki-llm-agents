import { describe, expect, it } from "vitest";
import { cleanFontName, DEFAULT_FONTS, fontStack, fontStacks, parseFontChoices } from "./fonts.ts";

describe("font stacks", () => {
  it("keeps the bundled font for default", () => {
    expect(fontStack("ui", { kind: "default" })).toBeNull();
    expect(fontStacks(DEFAULT_FONTS)).toEqual({});
  });

  it("uses the device's generic families for system", () => {
    expect(fontStack("ui", { kind: "system" })).toBe("system-ui, sans-serif");
    expect(fontStack("mono", { kind: "system" })).toBe("ui-monospace, monospace");
    expect(fontStack("read", { kind: "system" })).toBe("ui-serif, serif");
  });

  it("puts a custom font first, quoted, with the system font behind it", () => {
    expect(fontStack("mono", { kind: "custom", name: "  JetBrains Mono " })).toBe('"JetBrains Mono", ui-monospace, monospace');
  });

  it("escapes quotes and backslashes so a name can't break out of its string", () => {
    expect(fontStack("ui", { kind: "custom", name: 'Odd "Name"\\' })).toBe('"Odd \\"Name\\"\\\\", system-ui, sans-serif');
  });

  it("uses the system font until a custom name is typed", () => {
    expect(fontStack("read", { kind: "custom", name: " " })).toBe("ui-serif, serif");
  });

  it("maps each overridden role to its token", () => {
    expect(fontStacks({ ui: { kind: "system" }, mono: { kind: "custom", name: "Fira Code" }, read: { kind: "default" } })).toEqual({
      "--font-ui": "system-ui, sans-serif",
      "--font-mono": '"Fira Code", ui-monospace, monospace',
    });
  });
});

describe("stored font choices", () => {
  it("reads valid choices and defaults the rest", () => {
    expect(parseFontChoices({ ui: { kind: "system" }, mono: { kind: "custom", name: "Fira Code" }, read: { kind: "bogus" } })).toEqual({
      ui: { kind: "system" },
      mono: { kind: "custom", name: "Fira Code" },
      read: { kind: "default" },
    });
    expect(parseFontChoices(null)).toEqual(DEFAULT_FONTS);
    expect(parseFontChoices({ ui: { kind: "custom" } })).toEqual(DEFAULT_FONTS);
  });

  it("drops control characters from names", () => {
    expect(cleanFontName("Fira\nCode\t")).toBe("FiraCode");
  });
});
