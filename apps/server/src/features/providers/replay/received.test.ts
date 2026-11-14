import { describe, expect, it } from "vitest";
import { attachedFilesText } from "../../threads/attached-files.js";
import { receivedText } from "./adapter.js";

describe("receivedText", () => {
  it("lists the images sent as images and the files listed in the text", () => {
    const files = attachedFilesText([
      { id: "1", name: "sales.csv", mime: "text/csv", size: 2048, kind: "file", path: "/data/attachments/abc/sales.csv" },
      { id: "2", name: 'odd "name".json', mime: "application/json", size: 12, kind: "file", path: '/data/attachments/def/odd "name".json' },
    ]);
    const images = [{ path: "/data/attachments/123/shot.png", name: "shot.png", mime: "image/png", size: 1536 }];
    expect(receivedText(`Look at these\n${files}`, images)).toBe(
      'Replay received: image shot.png (image/png, 1.5 KB); file sales.csv (text/csv, 2.0 KB); file odd "name".json (application/json, 12 B).',
    );
  });

  it("is null when nothing arrived", () => {
    expect(receivedText("- just a list item (not a file, really)", [])).toBeNull();
  });
});
