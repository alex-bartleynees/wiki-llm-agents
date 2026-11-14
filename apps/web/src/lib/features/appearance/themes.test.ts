import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseThemeChoice, resolveTheme, THEMES } from "./themes.ts";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("theme choices", () => {
  it("keeps known choices and falls back to system", () => {
    expect(parseThemeChoice("gruvbox-dark-hard")).toBe("gruvbox-dark-hard");
    expect(parseThemeChoice("dark")).toBe("dark");
    expect(parseThemeChoice("system")).toBe("system");
    expect(parseThemeChoice(null)).toBe("system");
    expect(parseThemeChoice("solarized")).toBe("system");
  });

  it("resolves system from the device setting and keeps any other choice", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("gruvbox-dark-hard", false)).toBe("gruvbox-dark-hard");
    expect(resolveTheme("light", true)).toBe("light");
  });
});

describe("first paint in app.html", () => {
  const tokens = source("../../ui/tokens.css");
  const html = source("../../../app.html");

  it("knows every theme and no others", () => {
    const ids = JSON.parse(/var themes = (\[[^\]]*\]);/.exec(html)?.[1] ?? "null") as unknown;
    expect(ids).toEqual(THEMES.map((theme) => theme.id));
  });

  it.each(THEMES)("paints $label with its tokens' background and colour scheme", ({ id, scheme }) => {
    const block = new RegExp(String.raw`\[data-theme-preview="${id}"\]\s*\{([^}]*)\}`).exec(tokens)?.[1] ?? "";
    expect(block).toContain(`color-scheme: ${scheme};`);
    const bg = /--bg:\s*([^;]+);/.exec(block)?.[1];
    expect(bg).toBeDefined();
    const selector = id === "light" ? "html" : `html[data-theme="${id}"]`;
    expect(html).toContain(`${selector} { background: ${bg}; color-scheme: ${scheme}; }`);
  });
});
