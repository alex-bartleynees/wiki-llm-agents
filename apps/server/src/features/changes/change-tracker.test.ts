import { describe, expect, it } from "vitest";
import { vaultPathOf } from "./change-tracker.js";

describe("vaultPathOf", () => {
  const roots = ["/real/vault", "/home/me/vault"];
  it.each([
    ["/real/vault/Notes/Tea.md", "Notes/Tea.md"],
    ["/home/me/vault/Tea.md", "Tea.md"],
    ["/real/vault/.obsidian/app.json", undefined],
    ["/real/vault", undefined],
    ["/real/vaults/Tea.md", undefined],
    ["/real/vault/../secret.md", undefined],
    ["Notes/Tea.md", undefined],
  ])("%s → %s", (absolute, expected) => {
    expect(vaultPathOf(roots, absolute)).toBe(expected);
  });
});
