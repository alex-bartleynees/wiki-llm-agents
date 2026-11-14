import { describe, expect, it } from "vitest";
import { attachmentFileName, classifyAttachment, sniffImage } from "./classify.js";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const GIF = new TextEncoder().encode("GIF89a");
const WEBP = new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ");
const CSV = new TextEncoder().encode("TimeGenerated,Message\n");

describe("attachmentFileName", () => {
  it.each([
    ["query_data.csv", "query_data.csv"],
    ["C:\\Users\\me\\export.csv", "export.csv"],
    ["../../etc/passwd", "passwd"],
    ["a:b*c?.txt", "a-b-c-.txt"],
    ["  .hidden", "hidden"],
    ["line\nbreak.log", "line-break.log"],
    ["/", undefined],
    ["...", undefined],
  ])("%j → %j", (name, expected) => expect(attachmentFileName(name)).toBe(expected));

  it("keeps the extension when it shortens a long name", () => {
    const name = attachmentFileName(`${"x".repeat(300)}.csv`)!;
    expect(name).toHaveLength(200);
    expect(name.endsWith(".csv")).toBe(true);
  });
});

describe("sniffImage", () => {
  it("knows images by their bytes", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(JPEG)).toBe("image/jpeg");
    expect(sniffImage(GIF)).toBe("image/gif");
    expect(sniffImage(WEBP)).toBe("image/webp");
    expect(sniffImage(CSV)).toBeUndefined();
    expect(sniffImage(new Uint8Array())).toBeUndefined();
  });
});

describe("classifyAttachment", () => {
  it("sends images as images, whatever their name says", () => {
    expect(classifyAttachment("screenshot.png", PNG)).toEqual({ mime: "image/png", kind: "image" });
    expect(classifyAttachment("photo", JPEG)).toEqual({ mime: "image/jpeg", kind: "image" });
  });

  it("sends an image over 5 MB as a file", () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG);
    expect(classifyAttachment("big.png", big)).toEqual({ mime: "image/png", kind: "file" });
  });

  it("types other files by extension, and never trusts an image extension", () => {
    expect(classifyAttachment("query_data.CSV", CSV)).toEqual({ mime: "text/csv", kind: "file" });
    expect(classifyAttachment("dump.json", CSV)).toEqual({ mime: "application/json", kind: "file" });
    expect(classifyAttachment("fake.png", CSV)).toEqual({ mime: "application/octet-stream", kind: "file" });
    expect(classifyAttachment("drawing.svg", CSV)).toEqual({ mime: "application/octet-stream", kind: "file" });
    expect(classifyAttachment("archive.bin", CSV)).toEqual({ mime: "application/octet-stream", kind: "file" });
  });
});
