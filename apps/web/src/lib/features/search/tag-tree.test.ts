import { describe, expect, it } from "vitest";
import { tagTree } from "./tag-tree.ts";

describe("tagTree", () => {
  const tags = [
    { tag: "project/app", count: 3 },
    { tag: "tea", count: 5 },
    { tag: "project", count: 1 },
    { tag: "area/home/garden", count: 2 },
    { tag: "Project/web", count: 1 },
  ];

  it("nests tags by slash, with totals, sorted by name", () => {
    expect(tagTree(tags)).toEqual([
      {
        name: "area",
        tag: "area",
        count: 0,
        total: 2,
        children: [
          { name: "home", tag: "area/home", count: 0, total: 2, children: [{ name: "garden", tag: "area/home/garden", count: 2, total: 2, children: [] }] },
        ],
      },
      {
        name: "project",
        tag: "project",
        count: 1,
        total: 5,
        children: [
          { name: "app", tag: "project/app", count: 3, total: 3, children: [] },
          { name: "web", tag: "project/web", count: 1, total: 1, children: [] },
        ],
      },
      { name: "tea", tag: "tea", count: 5, total: 5, children: [] },
    ]);
  });

  it("keeps the tags matching a filter, and their parents", () => {
    expect(tagTree(tags, "#GARD").map((node) => node.tag)).toEqual(["area"]);
    expect(tagTree(tags, "app")).toEqual([
      { name: "project", tag: "project", count: 0, total: 3, children: [{ name: "app", tag: "project/app", count: 3, total: 3, children: [] }] },
    ]);
  });
});
