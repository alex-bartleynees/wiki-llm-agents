import { describe, expect, it } from "vitest";
import { imageFiles, imageName } from "./images.ts";

const now = new Date(2026, 10, 13, 10, 15, 0);

describe("imageName", () => {
  it("names pasted images by time, as Obsidian does", () => {
    expect(imageName({ name: "image.png", type: "image/png" }, true, now)).toBe("Pasted image 20261113101500.png");
    expect(imageName({ name: "", type: "image/jpeg" }, false, now)).toBe("Pasted image 20261113101500.jpg");
  });

  it("keeps a dropped or chosen file's name, adding an extension it lacks", () => {
    expect(imageName({ name: "IMG_1234.HEIC.jpg", type: "image/jpeg" }, false, now)).toBe("IMG_1234.HEIC.jpg");
    expect(imageName({ name: "diagram", type: "image/webp" }, false, now)).toBe("diagram.webp");
  });
});

describe("imageFiles", () => {
  it("keeps images, by type or extension, and leaves out SVG and other files", () => {
    const files = [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.svg", { type: "image/svg+xml" }),
      new File(["c"], "c.txt", { type: "text/plain" }),
      new File(["d"], "d.JPEG", { type: "" }),
    ];
    expect(imageFiles(files).map((file) => file.name)).toEqual(["a.png", "d.JPEG"]);
    expect(imageFiles(null)).toEqual([]);
  });
});
