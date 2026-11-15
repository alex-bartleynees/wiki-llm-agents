import type { DiffFile, DirectoryDiff } from "@wiki-agents/contracts/projects/model";
import { describe, expect, it } from "vitest";
import { commitRequest, isTicked } from "./commit-request.ts";

const file = (path: string, extra: Partial<DiffFile> = {}): DiffFile => ({
  path,
  oldPath: null,
  status: "modified",
  binary: false,
  additions: 1,
  deletions: 0,
  diff: "",
  truncated: false,
  hash: `hash-${path}`,
  ...extra,
});
const directory: DirectoryDiff = { directory: "/repo", git: true, head: "abc", files: [], changes: [], ignored: [] };

describe("commit request", () => {
  it("ticks files in review unless unticked, and ignored files only when ticked", () => {
    const ticks = { unticked: new Set(["a"]), ticked: new Set(["b"]) };
    expect([isTicked(ticks, "a", false), isTicked(ticks, "c", false), isTicked(ticks, "b", true), isTicked(ticks, "d", true)]).toEqual([false, true, true, false]);
  });

  it("carries the reviewed HEAD and hashes, and both sides of a rename", () => {
    expect(commitRequest(directory, [file("app.ts"), file("gone.ts", { status: "deleted", hash: null }), file("new.ts", { status: "renamed", oldPath: "old.ts" })], "Msg")).toEqual({
      directory: "/repo",
      head: "abc",
      message: "Msg",
      files: [
        { path: "app.ts", hash: "hash-app.ts" },
        { path: "gone.ts", hash: null },
        { path: "new.ts", hash: "hash-new.ts" },
        { path: "old.ts", hash: null },
      ],
    });
  });

  it("names a rename's old path once when it is also listed, and sends null before the first commit", () => {
    const request = commitRequest({ ...directory, head: null }, [file("b", { status: "renamed", oldPath: "a" }), file("a", { status: "added" })], "Msg");
    expect(request.head).toBeNull();
    expect(request.files.map((entry) => entry.path)).toEqual(["b", "a"]);
  });
});
