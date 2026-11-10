import { describe, expect, it } from "vitest";
import { foldersInside, parentFolder } from "./vault-folders.ts";

const entries = ["index.md", "1-Active/App/plan.md", "1-Active/App/img/a.png", "1-Active/Home.md", "2-Areas/x.md", "1-Active/app10/n.md", "1-Active/app9/n.md"].map(
  (path) => ({ path }),
);

describe("vault folders", () => {
  it("lists the folders directly inside a folder, by name, from file paths", () => {
    expect(foldersInside(entries, "")).toEqual([
      { name: "1-Active", path: "1-Active" },
      { name: "2-Areas", path: "2-Areas" },
    ]);
    expect(foldersInside(entries, "1-Active").map((folder) => folder.path)).toEqual(["1-Active/App", "1-Active/app9", "1-Active/app10"]);
    expect(foldersInside(entries, "1-Active/App")).toEqual([{ name: "img", path: "1-Active/App/img" }]);
    expect(foldersInside(entries, "1-Active/App/img")).toEqual([]);
  });

  it("doesn't mistake a folder whose name starts the same for a child", () => {
    expect(foldersInside([{ path: "Active-old/x/y.md" }, { path: "Active/z.md" }], "Active")).toEqual([]);
  });

  it("goes up one folder at a time to the root", () => {
    expect(parentFolder("1-Active/App/img")).toBe("1-Active/App");
    expect(parentFolder("1-Active")).toBe("");
    expect(parentFolder("")).toBeNull();
  });
});
