import { describe, expect, it } from "vitest";
import { attachedFilesText, formatSize } from "./attached-files.js";

describe("attachedFilesText", () => {
  it("is empty without files", () => expect(attachedFilesText([])).toBe(""));

  it("lists each file's path, type and size, not its content", () => {
    const text = attachedFilesText([
      { id: "1", name: "query_data.csv", mime: "text/csv", size: 12_900_000, kind: "file", path: "/data/attachments/ab/query_data.csv" },
      { id: "2", name: "big.png", mime: "image/png", size: 2048, kind: "image", path: "/data/attachments/cd/big.png" },
    ]);
    expect(text.split("\n")).toEqual([
      expect.stringContaining("Attached files"),
      '- "/data/attachments/ab/query_data.csv" (text/csv, 12.3 MB)',
      '- "/data/attachments/cd/big.png" (image/png, 2.0 KB)',
    ]);
  });
});

describe("formatSize", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1536, "1.5 KB"],
    [5 * 1024 * 1024, "5.0 MB"],
  ])("%d → %s", (bytes, expected) => expect(formatSize(bytes)).toBe(expected));
});
