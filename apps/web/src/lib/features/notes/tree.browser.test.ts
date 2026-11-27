import { beforeEach, describe, expect, it, vi } from "vitest";

const getTree = vi.hoisted(() => vi.fn());
vi.mock("./api.ts", () => ({ getTree }));

const { tree } = await import("./tree.svelte.ts");

describe("TreeStore client-side quick switch", () => {
  beforeEach(() => {
    getTree.mockReset();
  });

  it("matches titles and paths synchronously once loaded and returns null for unloaded vaults", async () => {
    expect(tree.match("unloaded", "plan")).toBeNull();

    getTree.mockResolvedValueOnce({
      entries: [
        { path: "assets/photo.png", kind: "file", title: "photo.png" },
        { path: "Projects/Plan.md", kind: "note", title: "Migration Plan" },
        { path: "Notes/Tea.md", kind: "note", title: "Tea Log" },
      ],
    });
    await tree.load("v1", { refresh: true });

    const matches = tree.match("v1", "mig plan");
    expect(matches).toEqual([
      {
        path: "Projects/Plan.md",
        kind: "note",
        title: "Migration Plan",
        match: { field: "title", positions: [0, 1, 2, 10, 11, 12, 13] },
      },
    ]);
    expect(tree.match("other-vault", "plan")).toBeNull();
    expect(getTree).toHaveBeenCalledTimes(1);
  });
});
