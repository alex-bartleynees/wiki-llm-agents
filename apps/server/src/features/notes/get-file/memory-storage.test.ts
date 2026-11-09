import { describe, expect, it } from "vitest";
import { withMemoryStorage } from "./memory-storage.js";

describe("withMemoryStorage", () => {
  it("goes after the doctype, keeping standards mode", () => {
    const html = withMemoryStorage("<!DOCTYPE html>\n<html><head></head></html>");
    expect(html.startsWith("<!DOCTYPE html><script>")).toBe(true);
    expect(html.endsWith("</script>\n<html><head></head></html>")).toBe(true);
  });

  it("handles a byte-order mark and leading whitespace before the doctype", () => {
    expect(withMemoryStorage("﻿  <!doctype html><p>x</p>").startsWith("﻿  <!doctype html><script>")).toBe(true);
  });

  it("goes first when there is no doctype", () => {
    expect(withMemoryStorage("<p>x</p>").startsWith("<script>")).toBe(true);
  });

  it("only replaces storage that throws", () => {
    const html = withMemoryStorage("");
    expect(html).toContain("try { void window[name]; } catch (error) {");
  });

  it("gives a working Storage-like object", () => {
    const body = /<script>([\s\S]*)<\/script>/.exec(withMemoryStorage(""))![1]!;
    const window: Record<string, unknown> = {};
    Object.defineProperty(window, "localStorage", { get: () => { throw new Error("SecurityError"); }, configurable: true });
    window["sessionStorage"] = "native";
    new Function("window", body)(window);
    const storage = window["localStorage"] as Storage;
    storage.setItem("theme", "dark");
    expect([storage.getItem("theme"), storage.length, storage.key(0), storage.getItem("missing")]).toEqual(["dark", 1, "theme", null]);
    storage.clear();
    expect(storage.length).toBe(0);
    expect(window["sessionStorage"]).toBe("native");
  });
});
