import { describe, expect, it } from "vitest";
import { isInsidePath } from "./paths.js";

describe("isInsidePath", () => {
  it("accepts relative paths that stay inside", () => {
    for (const path of ["a.ts", "src/a.ts", "..a/b", "a..b"]) expect(isInsidePath(path)).toBe(true);
  });

  it("refuses absolute, empty, dot and parent segments", () => {
    for (const path of ["", "/etc/passwd", "../a", "a/../../b", "./a", "a//b", "a/", "a\0b"]) expect(isInsidePath(path)).toBe(false);
  });
});
